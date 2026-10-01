// Slack plugin module routes Work Object flexpane requests to plugin interactive handlers.
import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from "@slack/bolt";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { danger } from "openclaw/plugin-sdk/runtime-env";
import { dispatchSlackPluginInteractiveHandler } from "../../interactive-dispatch.js";
import { authorizeSlackSystemEventSender } from "../auth.js";
import type { SlackMonitorContext } from "../context.js";
import { resolveSlackListenerEventScope } from "./system-event-context.js";

type EntityDetailsRequestedEvent = SlackEventMiddlewareArgs<"entity_details_requested">["event"];

const noop = async () => {};

/** Routes `entity_details_requested` to the plugin whose namespace equals `external_ref.type`. */
export async function handleSlackEntityDetailsRequested(params: {
  ctx: SlackMonitorContext;
  trackEvent?: () => void;
  body: unknown;
  event: unknown;
  context?: AllMiddlewareArgs["context"];
  client?: AllMiddlewareArgs["client"];
}): Promise<void> {
  const { ctx, trackEvent, body } = params;
  try {
    const eventScope = resolveSlackListenerEventScope({
      ctx,
      body,
      context: params.context,
      client: params.client,
    });
    if (eventScope === null) {
      return;
    }
    if (ctx.shouldDropMismatchedSlackEvent(body)) {
      return;
    }
    trackEvent?.();
    const event = params.event as Partial<EntityDetailsRequestedEvent>;
    const refType = event.external_ref?.type?.trim();
    const refId = event.external_ref?.id?.trim();
    if (!refType || !refId || !event.trigger_id) {
      ctx.runtime.log?.(
        `slack:entity_details drop reason=missing-${!refType ? "ref-type" : !refId ? "ref-id" : "trigger-id"}`,
      );
      return;
    }
    const auth = await authorizeSlackSystemEventSender({
      ctx,
      senderId: event.user,
      channelId: event.channel,
      eventScope,
    });
    const interactionId = ["entity", event.channel, event.message_ts, event.user, event.event_ts]
      .filter(Boolean)
      .join(":");
    const result = await dispatchSlackPluginInteractiveHandler({
      data: `${refType}:${refId}`,
      interactionId,
      teamId: eventScope?.teamId,
      ctx: {
        accountId: ctx.accountId,
        interactionId,
        conversationId: event.channel ?? "",
        parentConversationId: undefined,
        threadId: event.thread_ts,
        senderId: event.user,
        senderUsername: undefined,
        auth: { isAuthorizedSender: auth.allowed },
        interaction: {
          kind: "entity_details_requested",
          externalRef: { id: refId, type: refType },
          entityUrl: event.entity_url,
          appUnfurlUrl: event.app_unfurl_url,
          triggerId: event.trigger_id,
          userLocale: event.user_locale,
          messageTs: event.message_ts,
          threadTs: event.thread_ts,
        },
      },
      respond: { acknowledge: noop, reply: noop, followUp: noop, editMessage: noop },
    });
    if (!result.matched) {
      ctx.runtime.log?.(`slack:entity_details drop reason=no-plugin-namespace type=${refType}`);
    }
  } catch (err) {
    ctx.runtime.error?.(danger(`slack entity details handler failed: ${formatErrorMessage(err)}`));
  }
}

export function registerSlackEntityEvents(params: {
  ctx: SlackMonitorContext;
  trackEvent?: () => void;
}) {
  const { ctx, trackEvent } = params;
  ctx.app.event(
    "entity_details_requested",
    async (args: SlackEventMiddlewareArgs<"entity_details_requested"> & AllMiddlewareArgs) => {
      const { event, body, context, client } = args;
      await handleSlackEntityDetailsRequested({ ctx, trackEvent, body, event, context, client });
    },
  );
}
