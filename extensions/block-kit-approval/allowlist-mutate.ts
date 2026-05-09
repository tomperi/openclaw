import { approveChannelPairingCode } from "openclaw/plugin-sdk/conversation-runtime";

export type ApproveResult = { ok: true; senderId: string } | { ok: false; error: string };

export async function approvePairingCode(params: {
  reqId: string;
  accountId: string;
}): Promise<ApproveResult> {
  try {
    const result = await approveChannelPairingCode({
      channel: "slack",
      code: params.reqId,
      accountId: params.accountId,
      env: process.env,
    });
    if (!result) {
      return { ok: false, error: "no matching pairing request" };
    }
    return { ok: true, senderId: result.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
