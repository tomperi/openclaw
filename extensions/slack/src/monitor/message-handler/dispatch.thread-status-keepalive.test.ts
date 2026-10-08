import { WebClient } from "@slack/web-api";
import {
  buildChannelInboundEventContext,
  resolveChannelInboundRouteEnvelope,
} from "openclaw/plugin-sdk/channel-inbound";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedSlackMessage } from "./types.js";

type PipelineOptions = Parameters<
  typeof import("openclaw/plugin-sdk/channel-outbound").createChannelMessageReplyPipeline
>[0];
let capturedTyping: PipelineOptions["typing"];
vi.mock("openclaw/plugin-sdk/channel-outbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/channel-outbound")>();
  return {
    ...actual,
    createChannelMessageReplyPipeline: (options: PipelineOptions) => {
      capturedTyping = options.typing;
      return { onModelSelected: vi.fn() };
    },
  };
});
vi.mock("../../actions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../actions.js")>()),
  reactSlackMessage: vi.fn(async () => undefined),
  removeSlackReaction: vi.fn(async () => undefined),
}));

async function fixture(params: { agentSessions: boolean }) {
  // The agent-session fallback is process state; each test starts from a fresh module graph.
  vi.resetModules();
  const { createSlackDispatchSetup } = await import("./dispatch-setup.js");
  const { createInboundSlackTestContext, createSlackTestAccount } =
    await import("./prepare.test-helpers.js");
  const client = new WebClient();
  const api = vi.spyOn(client, "apiCall").mockImplementation(async (method) => {
    if (method === "agents.sessions.setStatus" && !params.agentSessions) {
      throw Object.assign(new Error("An API error occurred: not_authorized"), {
        data: { ok: false, error: "not_authorized" },
      });
    }
    return method === "agents.sessions.rename" ? { ok: false } : { ok: true };
  });
  const ctx = createInboundSlackTestContext({ cfg: {}, appClient: client, replyToMode: "all" });
  ctx.runtime.error = vi.fn();
  ctx.runtime.log = vi.fn();
  ctx.typingReaction = "";
  const { route } = resolveChannelInboundRouteEnvelope({
    cfg: {},
    channel: "slack",
    accountId: "default",
    peer: { kind: "group", id: "C1" },
  });
  const ctxPayload = buildChannelInboundEventContext({
    channel: "slack",
    accountId: "default",
    messageId: "1.000",
    from: "slack:channel:C1",
    sender: { id: "U1" },
    conversation: { kind: "group", id: "C1", threadId: "1.000" },
    route: {
      agentId: route.agentId,
      dmScope: route.dmScope,
      accountId: route.accountId,
      routeSessionKey: route.sessionKey,
      dispatchSessionKey: route.sessionKey,
    },
    reply: { to: "channel:C1", originatingTo: "channel:C1", messageThreadId: "1.000" },
    message: { body: "hello", bodyForAgent: "hello", rawBody: "hello", commandBody: "hello" },
  });
  const prepared: PreparedSlackMessage = {
    ctx,
    account: createSlackTestAccount({ streaming: { mode: "off" } }),
    message: {
      type: "message",
      channel: "C1",
      user: "U1",
      ts: "1.000",
      thread_ts: "1.000",
      text: "hello",
    },
    route,
    channelConfig: null,
    replyTarget: "channel:C1",
    ctxPayload,
    turn: { storePath: "/unused/slack-status-test", record: {} },
    replyToMode: "all",
    requireMention: false,
    isDirectMessage: false,
    isRoomish: true,
    preview: "hello",
    ackReactionValue: "",
    ackReactionPromise: null,
  };
  const setup = await createSlackDispatchSetup(prepared);
  const typing = capturedTyping;
  if (!typing?.start || !typing.stop) {
    throw new Error("registered typing callbacks missing");
  }
  const output = { visible: false };
  setup.threadStatusGate.hasVisibleOutput = () => output.visible;
  const threadStatusWrites = () =>
    api.mock.calls.filter(([method]) => method === "assistant.threads.setStatus");
  return { api, output, threadStatusWrites, start: typing.start, stop: typing.stop };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
  capturedTyping = undefined;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Slack assistant-thread status keepalive", () => {
  it("re-asserts the fallback status after the progress card posts, then every 30 seconds", async () => {
    const f = await fixture({ agentSessions: false });
    await f.start();
    await f.start();
    expect(f.threadStatusWrites()).toHaveLength(1);

    f.output.visible = true;
    await f.start();
    await f.start();
    expect(f.threadStatusWrites()).toHaveLength(2);

    vi.advanceTimersByTime(29_000);
    await f.start();
    expect(f.threadStatusWrites()).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    await f.start();
    expect(f.threadStatusWrites()).toHaveLength(3);
    expect(f.threadStatusWrites().at(-1)?.[1]).toMatchObject({ status: "is thinking..." });
  });

  it("keeps the fallback status after a native progress stream counts as delivered, until stop", async () => {
    const f = await fixture({ agentSessions: false });
    await f.start();
    // Native progress marks the reply delivered when the card first streams.
    f.output.visible = true;
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(30_000);
      await f.start();
    }
    expect(f.threadStatusWrites()).toHaveLength(5);
    await f.stop();
    expect(f.threadStatusWrites().at(-1)?.[1]).toMatchObject({ status: "" });
    vi.advanceTimersByTime(30_000);
    await f.start();
    expect(f.threadStatusWrites()).toHaveLength(6);
  });

  it("writes an agent-session status once, as upstream does", async () => {
    const f = await fixture({ agentSessions: true });
    await f.start();
    f.output.visible = true;
    vi.advanceTimersByTime(120_000);
    await f.start();
    const sessionWrites = f.api.mock.calls.filter(
      ([method]) => method === "agents.sessions.setStatus",
    );
    expect(sessionWrites).toHaveLength(1);
    expect(f.threadStatusWrites()).toHaveLength(0);
  });
});
