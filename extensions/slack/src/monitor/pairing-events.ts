// In-process listener registry for "pairing request created" events on the
// Slack channel. Other plugins (e.g. block-kit-approval) subscribe at register
// time; dm-auth.ts notifies when a fresh pairing challenge is issued.
//
// This is intentionally a minimal event surface — no persistence, no
// session-scoping, fire-and-forget. Listener errors are isolated so one
// misbehaving subscriber cannot break the auth path.

export type PairingRequestCreatedEvent = {
  code: string;
  senderId: string;
  senderName?: string;
  accountId: string;
  /** Originating channel ID. Present when the pairing was triggered by a room
   *  message; absent for DM-initiated pairings. */
  channelId?: string;
  /** Originating channel name (best-effort). */
  channelName?: string;
  /** Originating thread timestamp, if the message was posted in a thread. */
  threadTs?: string;
  /** First message text from the requester (truncated upstream). */
  originalText?: string;
};

export type PairingRequestCreatedListener = (
  event: PairingRequestCreatedEvent,
) => void | Promise<void>;

const listeners = new Set<PairingRequestCreatedListener>();

export function subscribeToPairingRequestCreated(
  listener: PairingRequestCreatedListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyPairingRequestCreated(event: PairingRequestCreatedEvent): void {
  for (const listener of listeners) {
    try {
      const result = listener(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          // Listener errors are deliberately swallowed; the auth path must not
          // depend on subscriber health.
        });
      }
    } catch {
      // See above.
    }
  }
}

export function clearPairingEventListenersForTest(): void {
  listeners.clear();
}
