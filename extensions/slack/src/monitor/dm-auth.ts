import { formatAllowlistMatchMeta } from "openclaw/plugin-sdk/allow-from";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { resolveSlackAllowListMatch } from "./allow-list.js";
import type { SlackMonitorContext } from "./context.js";
import { upsertChannelPairingRequest } from "./conversation.runtime.js";
import { notifyPairingRequestCreated } from "./pairing-events.js";

const ORIGINAL_TEXT_PREVIEW_MAX = 600;

function truncateOriginalText(text?: string): string | undefined {
  if (!text) {
    return undefined;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > ORIGINAL_TEXT_PREVIEW_MAX
    ? `${trimmed.slice(0, ORIGINAL_TEXT_PREVIEW_MAX)}…`
    : trimmed;
}

async function issueSlackPairingChallenge(params: {
  ctx: SlackMonitorContext;
  accountId: string;
  senderId: string;
  senderName?: string;
  // Surface the originating channel/thread/message so subscribers (e.g. the
  // block-kit-approval plugin) can route the approve/deny reply back to the
  // same place. Omit channelId for DM-triggered pairings.
  channelId?: string;
  channelName?: string;
  threadTs?: string;
  originalText?: string;
  sendPairingReply: (text: string) => Promise<void>;
  log: (message: string) => void;
  allowMatchMeta: string;
}): Promise<void> {
  await createChannelPairingChallengeIssuer({
    channel: "slack",
    upsertPairingRequest: async ({ id, meta }) =>
      await upsertChannelPairingRequest({
        channel: "slack",
        id,
        accountId: params.accountId,
        meta,
      }),
  })({
    senderId: params.senderId,
    senderIdLine: `Your Slack user id: ${params.senderId}`,
    meta: { name: params.senderName },
    sendPairingReply: params.sendPairingReply,
    onCreated: ({ code }) => {
      params.log(
        `slack pairing request sender=${params.senderId} name=${params.senderName ?? "unknown"} channel=${params.channelId ?? "dm"} (${params.allowMatchMeta})`,
      );
      notifyPairingRequestCreated({
        code,
        senderId: params.senderId,
        senderName: params.senderName,
        accountId: params.accountId,
        channelId: params.channelId,
        channelName: params.channelName,
        threadTs: params.threadTs,
        originalText: truncateOriginalText(params.originalText),
      });
    },
    onReplyError: (err) => {
      params.log(`slack pairing reply failed for ${params.senderId}: ${formatErrorMessage(err)}`);
    },
  });
}

export async function authorizeSlackDirectMessage(params: {
  ctx: SlackMonitorContext;
  accountId: string;
  senderId: string;
  allowFromLower: string[];
  resolveSenderName: (senderId: string) => Promise<{ name?: string }>;
  sendPairingReply: (text: string) => Promise<void>;
  originalText?: string;
  onDisabled: () => Promise<void> | void;
  onUnauthorized: (params: { allowMatchMeta: string; senderName?: string }) => Promise<void> | void;
  log: (message: string) => void;
}): Promise<boolean> {
  if (!params.ctx.dmEnabled || params.ctx.dmPolicy === "disabled") {
    await params.onDisabled();
    return false;
  }

  const sender = await params.resolveSenderName(params.senderId);
  const senderName = sender?.name ?? undefined;
  const allowMatch = resolveSlackAllowListMatch({
    allowList: params.allowFromLower,
    id: params.senderId,
    name: senderName,
    allowNameMatching: params.ctx.allowNameMatching,
  });
  const allowMatchMeta = formatAllowlistMatchMeta(allowMatch);
  if (allowMatch.allowed) {
    return true;
  }

  if (params.ctx.dmPolicy === "pairing") {
    await issueSlackPairingChallenge({
      ctx: params.ctx,
      accountId: params.accountId,
      senderId: params.senderId,
      senderName,
      originalText: params.originalText,
      sendPairingReply: params.sendPairingReply,
      log: params.log,
      allowMatchMeta,
    });
    return false;
  }

  await params.onUnauthorized({ allowMatchMeta, senderName });
  return false;
}

/**
 * Triggers a pairing challenge for an unknown sender posting in a room (channel
 * or group DM) when `dmPolicy === "pairing"`. Engagement-gated: callers should
 * only invoke this once they've determined the bot would otherwise respond
 * (mention, replyToMode, etc.) so unknown chatter in busy channels doesn't
 * spam the operator. Returns true if pairing was triggered (caller should drop
 * the message).
 */
export async function authorizeSlackRoomUnknownSender(params: {
  ctx: SlackMonitorContext;
  accountId: string;
  senderId: string;
  senderName?: string;
  allowFromLower: string[];
  channelId: string;
  channelName?: string;
  threadTs?: string;
  originalText?: string;
  log: (message: string) => void;
}): Promise<boolean> {
  if (params.ctx.dmPolicy !== "pairing") {
    return false;
  }
  const allowMatch = resolveSlackAllowListMatch({
    allowList: params.allowFromLower,
    id: params.senderId,
    name: params.senderName,
    allowNameMatching: params.ctx.allowNameMatching,
  });
  if (allowMatch.allowed) {
    return false;
  }
  const allowMatchMeta = formatAllowlistMatchMeta(allowMatch);
  await issueSlackPairingChallenge({
    ctx: params.ctx,
    accountId: params.accountId,
    senderId: params.senderId,
    senderName: params.senderName,
    channelId: params.channelId,
    channelName: params.channelName,
    threadTs: params.threadTs,
    originalText: params.originalText,
    // Don't reply publicly in the room — the plugin handles user-facing
    // followup once the operator approves/denies.
    sendPairingReply: async () => {},
    log: params.log,
    allowMatchMeta,
  });
  return true;
}
