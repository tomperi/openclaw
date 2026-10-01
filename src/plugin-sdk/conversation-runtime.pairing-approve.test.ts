import { describe, expect, it } from "vitest";
import { approveChannelPairingCode } from "../pairing/pairing-store.js";
import * as conversationRuntime from "./conversation-runtime.js";

describe("conversation-runtime pairing approval", () => {
  it("exports the core approveChannelPairingCode for operator pairing plugins", () => {
    expect((conversationRuntime as Record<string, unknown>).approveChannelPairingCode).toBe(
      approveChannelPairingCode,
    );
  });
});
