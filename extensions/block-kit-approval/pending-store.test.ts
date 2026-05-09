import { afterEach, describe, expect, it } from "vitest";
import { attachOwnerCard, get, remove, upsert, type PendingRequest } from "./pending-store.js";

function makeRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    reqId: "req-1",
    senderId: "U_SENDER",
    channel: "slack",
    accountId: "default",
    createdAtMs: 1_000,
    ...overrides,
  };
}

afterEach(() => {
  // Module state is shared; clean up known ids between tests.
  for (const id of ["req-1", "req-2"]) remove(id);
});

describe("pending-store", () => {
  it("upserts and retrieves a request", () => {
    const req = makeRequest();
    upsert(req);
    expect(get("req-1")).toEqual(req);
  });

  it("upsert replaces an existing entry", () => {
    upsert(makeRequest({ senderName: "first" }));
    upsert(makeRequest({ senderName: "second" }));
    expect(get("req-1")?.senderName).toBe("second");
  });

  it("remove deletes the entry", () => {
    upsert(makeRequest());
    remove("req-1");
    expect(get("req-1")).toBeUndefined();
  });

  it("attachOwnerCard merges channel + ts onto the existing entry", () => {
    upsert(makeRequest());
    attachOwnerCard("req-1", "D123", "1700000000.000100");
    expect(get("req-1")).toMatchObject({
      ownerCardChannel: "D123",
      ownerCardTs: "1700000000.000100",
    });
  });

  it("attachOwnerCard is a no-op for an unknown reqId", () => {
    attachOwnerCard("req-2", "D999", "1.0");
    expect(get("req-2")).toBeUndefined();
  });
});
