// Cross-extension import: this plugin is dedicated to the Slack channel and
// owns approval flow for it. Going through the generic outbound adapter would
// require building a full ReplyPayload to pipe Block Kit JSON through
// channelData.slack.blocks; the direct call is clearer for a one-off card.
import type { Block, KnownBlock } from "@slack/types";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { sendMessageSlack } from "../slack/src/send.runtime.js";
import { ownerCardHeader, ownerCardResolved } from "./messages.js";
import type { PendingRequest } from "./pending-store.js";

export type OwnerCardSendResult = {
  channel: string;
  ts: string;
};

const ORIGINAL_TEXT_MAX_CHARS = 600;

export async function sendOwnerApprovalCard(params: {
  api: OpenClawPluginApi;
  operatorSlackUserId: string;
  request: PendingRequest;
}): Promise<OwnerCardSendResult> {
  const { api, operatorSlackUserId, request } = params;
  const blocks = buildOwnerCardBlocks(request);
  const fallback = `${ownerCardHeader()} — ${request.senderName ?? request.senderId}`;
  const result = await sendMessageSlack(operatorSlackUserId, fallback, {
    cfg: api.config,
    accountId: request.accountId,
    blocks,
  });
  return { channel: result.channelId, ts: result.messageId };
}

function buildOwnerCardBlocks(request: PendingRequest): (Block | KnownBlock)[] {
  const fields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*User:* <@${request.senderId}> (\`${request.senderId}\`)` },
  ];
  if (request.senderEmail) {
    fields.push({ type: "mrkdwn", text: `*Email:* ${request.senderEmail}` });
  }
  const blocks: (Block | KnownBlock)[] = [
    { type: "header", text: { type: "plain_text", text: ownerCardHeader() } },
    { type: "section", fields },
  ];
  if (request.originalText) {
    const text = request.originalText;
    const truncated =
      text.length > ORIGINAL_TEXT_MAX_CHARS ? `${text.slice(0, ORIGINAL_TEXT_MAX_CHARS)}…` : text;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*First message:*\n> ${flattenForBlockquote(truncated)}` },
    });
  }
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "✅ Approve" },
        action_id: `bka:approve:${request.reqId}`,
        value: request.reqId,
      },
      {
        type: "button",
        style: "danger",
        text: { type: "plain_text", text: "❌ Deny" },
        action_id: `bka:deny:${request.reqId}`,
        value: request.reqId,
      },
    ],
  });
  return blocks;
}

function flattenForBlockquote(text: string): string {
  return text.replace(/\r?\n+/g, " ");
}

export function buildResolvedCardBlocks(params: {
  request: PendingRequest;
  decision: "approved" | "denied";
  operatorName: string;
  resolvedAt: Date;
}): (Block | KnownBlock)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${ownerCardHeader()}*\n${ownerCardResolved(params.decision, params.operatorName, params.resolvedAt)}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<@${params.request.senderId}> · \`${params.request.reqId}\``,
        },
      ],
    },
  ];
}
