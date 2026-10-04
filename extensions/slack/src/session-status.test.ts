// Slack tests cover session status writes and the assistant thread status fallback.
import { beforeEach, describe, expect, it, vi } from "vitest";

type ApiCall = ReturnType<typeof vi.fn>;

function notAgentAppError() {
  return Object.assign(new Error("An API error occurred: not_agent_app"), {
    data: { ok: false, error: "not_agent_app" },
  });
}

async function load() {
  vi.resetModules();
  return await import("./session-status.js");
}

function makeClient(apiCall: ApiCall) {
  return { apiCall } as unknown as Parameters<
    Awaited<ReturnType<typeof load>>["setSlackSessionStatus"]
  >[0]["client"];
}

describe("setSlackSessionStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses agent sessions when Slack accepts them", async () => {
    const { setSlackSessionStatus } = await load();
    const apiCall = vi.fn().mockResolvedValue({ ok: true });
    const result = await setSlackSessionStatus({
      client: makeClient(apiCall),
      channelId: "D1",
      threadTs: "1.000",
      status: "processing",
    });
    expect(result.ok).toBe(true);
    expect(apiCall.mock.calls.map((call) => call[0])).toEqual(["agents.sessions.setStatus"]);
  });

  it("falls back to the assistant thread loading status for apps that are not agent apps", async () => {
    const { setSlackSessionStatus } = await load();
    const apiCall = vi.fn(async (method: string) => {
      if (method === "agents.sessions.setStatus") {
        throw notAgentAppError();
      }
      return { ok: true };
    });
    const result = await setSlackSessionStatus({
      client: makeClient(apiCall),
      channelId: "D1",
      threadTs: "1.000",
      status: "processing",
      token: "xoxb-test",
    });
    expect(result.ok).toBe(true);
    expect(apiCall).toHaveBeenLastCalledWith("assistant.threads.setStatus", {
      channel_id: "D1",
      thread_ts: "1.000",
      status: "is thinking...",
      token: "xoxb-test",
    });
  });

  it("falls back when Slack reports agent sessions as not authorized", async () => {
    const { setSlackSessionStatus } = await load();
    const apiCall = vi.fn(async (method: string) => {
      if (method === "agents.sessions.setStatus") {
        throw Object.assign(new Error("An API error occurred: not_authorized"), {
          data: { ok: false, error: "not_authorized" },
        });
      }
      return { ok: true };
    });
    const result = await setSlackSessionStatus({
      client: makeClient(apiCall),
      channelId: "D1",
      threadTs: "1.000",
      status: "processing",
    });
    expect(result.ok).toBe(true);
    expect(apiCall).toHaveBeenLastCalledWith("assistant.threads.setStatus", {
      channel_id: "D1",
      thread_ts: "1.000",
      status: "is thinking...",
    });
  });

  it("clears the fallback status when the turn returns to active", async () => {
    const { setSlackSessionStatus } = await load();
    const apiCall = vi.fn(async (method: string) => {
      if (method === "agents.sessions.setStatus") {
        throw notAgentAppError();
      }
      return { ok: true };
    });
    const client = makeClient(apiCall);
    await setSlackSessionStatus({
      client,
      channelId: "D1",
      threadTs: "1.000",
      status: "processing",
    });
    const result = await setSlackSessionStatus({
      client,
      channelId: "D1",
      threadTs: "1.000",
      status: "active",
    });
    expect(result.ok).toBe(true);
    expect(apiCall).toHaveBeenLastCalledWith("assistant.threads.setStatus", {
      channel_id: "D1",
      thread_ts: "1.000",
      status: "",
    });
  });

  it("skips agent sessions after Slack reports the app is not an agent app", async () => {
    const { setSlackSessionStatus } = await load();
    const apiCall = vi.fn(async (method: string) => {
      if (method === "agents.sessions.setStatus") {
        throw notAgentAppError();
      }
      return { ok: true };
    });
    const client = makeClient(apiCall);
    await setSlackSessionStatus({
      client,
      channelId: "D1",
      threadTs: "1.000",
      status: "processing",
    });
    apiCall.mockClear();
    await setSlackSessionStatus({
      client,
      channelId: "D1",
      threadTs: "2.000",
      status: "processing",
    });
    expect(apiCall.mock.calls.map((call) => call[0])).toEqual(["assistant.threads.setStatus"]);
  });

  it("does not fall back for failures unrelated to the app type", async () => {
    const { setSlackSessionStatus } = await load();
    const apiCall = vi.fn().mockRejectedValue(
      Object.assign(new Error("An API error occurred: channel_not_found"), {
        data: { ok: false, error: "channel_not_found" },
      }),
    );
    const result = await setSlackSessionStatus({
      client: makeClient(apiCall),
      channelId: "D1",
      threadTs: "1.000",
      status: "processing",
    });
    expect(result.ok).toBe(false);
    expect(apiCall.mock.calls.map((call) => call[0])).toEqual(["agents.sessions.setStatus"]);
  });
});
