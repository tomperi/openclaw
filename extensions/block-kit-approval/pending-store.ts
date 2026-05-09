export type PendingRequest = {
  reqId: string;
  senderId: string;
  senderName?: string;
  senderEmail?: string;
  originalText?: string;
  channel: "slack";
  accountId: string;
  createdAtMs: number;
  ownerCardChannel?: string;
  ownerCardTs?: string;
};

const store = new Map<string, PendingRequest>();

export function upsert(req: PendingRequest): void {
  store.set(req.reqId, req);
}

export function get(reqId: string): PendingRequest | undefined {
  return store.get(reqId);
}

export function remove(reqId: string): void {
  store.delete(reqId);
}

export function attachOwnerCard(reqId: string, channel: string, ts: string): void {
  const existing = store.get(reqId);
  if (!existing) return;
  store.set(reqId, { ...existing, ownerCardChannel: channel, ownerCardTs: ts });
}
