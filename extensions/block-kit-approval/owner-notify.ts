import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PendingRequest } from "./pending-store.js";

export type OwnerCardSendResult = {
  channel: string;
  ts: string;
};

export async function sendOwnerApprovalCard(_params: {
  api: OpenClawPluginApi;
  operatorSlackUserId: string;
  request: PendingRequest;
}): Promise<OwnerCardSendResult> {
  throw new Error("sendOwnerApprovalCard: not implemented (step 3)");
}
