import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { subscribeToPairingRequestCreated } from "../slack/src/monitor/pairing-events.runtime.js";
import { createInteractiveHandler } from "./interactive-handler.js";
import { sendOwnerApprovalCard } from "./owner-notify.js";
import { attachOwnerCard, type PendingRequest, upsert as upsertPending } from "./pending-store.js";

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
          // Step 6 wires the actual approve/deny side effects (allowlist + replies).
          api.logger.info(
            `block-kit-approval: ${op} clicked for reqId=${reqId} by ${ctx.senderId}`,
          );
        },
      }),
    );

    subscribeToPairingRequestCreated(async (event) => {
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

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
