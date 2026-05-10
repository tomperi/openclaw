import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { subscribeToPairingRequestCreated } from "../slack/src/monitor/pairing-events.runtime.js";
import { sendMessageSlack } from "../slack/src/send.runtime.js";
import { approvePairingCode } from "./allowlist-mutate.js";
import { createInteractiveHandler, type InteractionOp } from "./interactive-handler.js";
import { APPROVED_REPLY, DENIED_REPLY } from "./messages.js";
import { buildResolvedCardBlocks, sendOwnerApprovalCard } from "./owner-notify.js";
import {
  attachOwnerCard,
  get as getPending,
  type PendingRequest,
  remove as removePending,
  upsert as upsertPending,
} from "./pending-store.js";

type BlockKitApprovalConfig = {
  operatorSlackUserId?: string;
};

export default definePluginEntry({
  id: "block-kit-approval",
  name: "Block Kit Approval",
  description: "Approve unknown Slack senders via Block Kit DM to operator.",
  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as BlockKitApprovalConfig;
    const operatorSlackUserId = cfg.operatorSlackUserId;
    if (!operatorSlackUserId) {
      api.logger.warn(
        "block-kit-approval: operatorSlackUserId not configured; pairing approvals are disabled",
      );
      return;
    }

    api.registerInteractiveHandler(
      createInteractiveHandler({
        operatorSlackUserId,
        resolve: async ({ op, reqId, ctx }) => {
          const request = getPending(reqId);
          if (!request) {
            api.logger.info(
              `block-kit-approval: ${op} clicked for unknown reqId=${reqId} (already resolved or restarted)`,
            );
            return;
          }
          try {
            await resolvePending({
              api,
              op,
              request,
              operatorSlackUserId: ctx.senderId ?? operatorSlackUserId,
              editOwnerCard: async (blocks) => {
                await ctx.respond.editMessage({ blocks });
              },
            });
          } finally {
            removePending(reqId);
          }
        },
      }),
    );

    subscribeToPairingRequestCreated(async (event) => {
      // Skip if we already issued a card for this code. Slack's
      // upsertChannelPairingRequest already short-circuits onCreated for
      // existing senders, but defending in depth keeps the operator from
      // getting duplicate cards on plugin reloads or any future regressions.
      if (getPending(event.code)) {
        return;
      }
      const request: PendingRequest = {
        reqId: event.code,
        senderId: event.senderId,
        senderName: event.senderName,
        channel: "slack",
        accountId: event.accountId,
        createdAtMs: Date.now(),
      };
      upsertPending(request);
      try {
        const sent = await sendOwnerApprovalCard({ api, operatorSlackUserId, request });
        attachOwnerCard(event.code, sent.channel, sent.ts);
      } catch (err) {
        api.logger.warn(
          `block-kit-approval: failed to send approval card for ${event.senderId}: ${formatError(err)}`,
        );
      }
    });
  },
});

async function resolvePending(params: {
  api: OpenClawPluginApi;
  op: InteractionOp;
  request: PendingRequest;
  operatorSlackUserId: string;
  editOwnerCard: (blocks: ReturnType<typeof buildResolvedCardBlocks>) => Promise<void>;
}): Promise<void> {
  const { api, op, request, operatorSlackUserId, editOwnerCard } = params;
  const decision = op === "approve" ? "approved" : "denied";
  const resolvedAt = new Date();

  if (op === "approve") {
    const approved = await approvePairingCode({
      reqId: request.reqId,
      accountId: request.accountId,
    });
    if (!approved.ok) {
      api.logger.warn(
        `block-kit-approval: approveChannelPairingCode failed for ${request.reqId}: ${approved.error}`,
      );
    }
    await sendCustomerReply(api, request, APPROVED_REPLY);
  } else {
    // Note: the underlying slack pairing-store entry lingers until TTL/restart;
    // there's no public delete API today.
    await sendCustomerReply(api, request, DENIED_REPLY);
  }

  await editOwnerCard(
    buildResolvedCardBlocks({
      request,
      decision,
      operatorName: `<@${operatorSlackUserId}>`,
      resolvedAt,
    }),
  );
}

async function sendCustomerReply(
  api: OpenClawPluginApi,
  request: PendingRequest,
  text: string,
): Promise<void> {
  try {
    await sendMessageSlack(request.senderId, text, {
      cfg: api.config,
      accountId: request.accountId,
    });
  } catch (err) {
    api.logger.warn(
      `block-kit-approval: failed to reply to ${request.senderId}: ${formatError(err)}`,
    );
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
