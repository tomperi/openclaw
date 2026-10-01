// Slack tests cover Work Object entity-details routing.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dispatchMock = vi.hoisted(() => vi.fn());
vi.mock("../../interactive-dispatch.js", () => ({
  dispatchSlackPluginInteractiveHandler: (...args: unknown[]) => dispatchMock(...args),
}));

let registerSlackEntityEvents: typeof import("./entities.js").registerSlackEntityEvents;
let createHarness: typeof import("./system-event-test-harness.js").createSlackSystemEventTestHarness;

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "entity_details_requested",
    user: "U1",
    trigger_id: "123.456.abc",
    entity_url: "https://example.com/thing/1",
    user_locale: "en-US",
    event_ts: "1.2",
    external_ref: { id: "env-1:AWS", type: "integration-monitor" },
    channel: "D1",
    message_ts: "100.200",
    ...overrides,
  };
}

function install() {
  const harness = createHarness();
  const log = vi.fn();
  (harness.ctx.runtime as { log?: unknown }).log = log;
  registerSlackEntityEvents({ ctx: harness.ctx });
  const handler = harness.getHandler("entity_details_requested");
  if (!handler) {
    throw new Error("expected entity_details_requested handler");
  }
  return { handler, log };
}

describe("registerSlackEntityEvents", () => {
  beforeAll(async () => {
    ({ registerSlackEntityEvents } = await import("./entities.js"));
    ({ createSlackSystemEventTestHarness: createHarness } =
      await import("./system-event-test-harness.js"));
  });

  beforeEach(() => {
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({ matched: true, handled: true, duplicate: false });
  });

  it("routes to the plugin namespace named by external_ref.type", async () => {
    const { handler } = install();
    await handler({ event: makeEvent(), body: {} });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const call = dispatchMock.mock.calls[0][0];
    expect(call.data).toBe("integration-monitor:env-1:AWS");
    expect(call.ctx.senderId).toBe("U1");
    expect(call.ctx.conversationId).toBe("D1");
    expect(call.ctx.interaction).toMatchObject({
      kind: "entity_details_requested",
      externalRef: { id: "env-1:AWS", type: "integration-monitor" },
      triggerId: "123.456.abc",
      messageTs: "100.200",
    });
  });

  it("drops an event without an external_ref type", async () => {
    const { handler, log } = install();
    await handler({ event: makeEvent({ external_ref: { id: "x" } }), body: {} });

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("slack:entity_details drop reason=missing-ref-type");
  });

  it("is registered by the workspace event set", async () => {
    const { registerSlackWorkspaceEvents } = await import("../events.js");
    const harness = createHarness();
    (harness.ctx as { cfg?: unknown }).cfg = { channels: {} };
    registerSlackWorkspaceEvents({ ctx: harness.ctx });
    expect(harness.getHandler("entity_details_requested")).toBeTruthy();
  });

  it("scopes enterprise requests to the listener workspace", async () => {
    const harness = createHarness();
    harness.ctx.installationIdentity = {
      kind: "enterprise",
      apiAppId: "A_GRID",
      enterpriseId: "E_GRID",
    };
    registerSlackEntityEvents({ ctx: harness.ctx });
    const handler = harness.getHandler("entity_details_requested");
    await handler?.({
      event: makeEvent(),
      body: { api_app_id: "A_GRID" },
      context: { isEnterpriseInstall: true, enterpriseId: "E_GRID", teamId: "T111" } as never,
      client: { token: "listener-T111" } as never,
    });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].teamId).toBe("T111");
  });

  it("logs when no plugin owns the namespace", async () => {
    dispatchMock.mockResolvedValue({ matched: false, handled: false, duplicate: false });
    const { handler, log } = install();
    await handler({ event: makeEvent(), body: {} });

    expect(log).toHaveBeenCalledWith(
      "slack:entity_details drop reason=no-plugin-namespace type=integration-monitor",
    );
  });
});
