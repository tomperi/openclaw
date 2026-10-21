import type {
  AgentsSessionsRenameArguments,
  AgentsSessionsSetStatusArguments,
  AgentsSessionsSetStatusResponse,
  WebClient,
} from "@slack/web-api";
import { defaultRuntime, logVerbose, warn, type RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { truncateUtf16Safe } from "openclaw/plugin-sdk/text-utility-runtime";
import { formatSlackError } from "./errors.js";

type SlackSessionStatus = "processing" | "active" | "suspended";
const MISSING_STOP_SUBSCRIPTION = "missing_agent_session_stopped_event_subscription";
let warnedMissingStopSubscription = false;

// Apps without Agent View cannot use agent sessions, but Slack's assistant thread
// loading status accepts chat:write in any thread.
const NOT_AGENT_APP_CODES = new Set([
  "not_agent_app",
  "not_authorized",
  "missing_scope",
  "unknown_method",
]);
const FALLBACK_STATUS_TEXT: Record<SlackSessionStatus, string> = {
  processing: "is thinking...",
  suspended: "is waiting for approval...",
  active: "",
};
let agentSessionsUnsupported = false;

/** True once Slack rejected agent sessions and statuses go through assistant.threads. */
export function usesAssistantThreadStatus(): boolean {
  return agentSessionsUnsupported;
}

function slackErrorCode(error: unknown): string | undefined {
  const data = (error as { data?: { error?: unknown } } | undefined)?.data;
  return typeof data?.error === "string" ? data.error : undefined;
}

async function setAssistantThreadStatus(params: {
  client: WebClient;
  channelId: string;
  threadTs: string;
  status: SlackSessionStatus;
  token?: string;
}): Promise<{ ok: true } | { ok: false }> {
  try {
    const response = await params.client.apiCall("assistant.threads.setStatus", {
      channel_id: params.channelId,
      thread_ts: params.threadTs,
      status: FALLBACK_STATUS_TEXT[params.status],
      ...(params.token ? { token: params.token } : {}),
    });
    return response.ok ? { ok: true } : { ok: false };
  } catch (error) {
    logVerbose(
      `slack thread status update failed for channel ${params.channelId}: ${formatSlackError(error)}`,
    );
    return { ok: false };
  }
}

export async function setSlackSessionStatus(params: {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  status: SlackSessionStatus;
  title?: string;
  token?: string;
  runtime?: RuntimeEnv;
}): Promise<{ ok: true; title?: string } | { ok: false }> {
  if (!params.threadTs) {
    return { ok: false };
  }
  const request = {
    channel_id: params.channelId,
    thread_ts: params.threadTs,
    status: params.status,
    ...(params.token ? { token: params.token } : {}),
    ...(params.title !== undefined ? { title: truncateUtf16Safe(params.title, 200) } : {}),
  } satisfies AgentsSessionsSetStatusArguments;
  if (agentSessionsUnsupported) {
    return await setAssistantThreadStatus({ ...params, threadTs: params.threadTs });
  }
  try {
    const response: AgentsSessionsSetStatusResponse = await params.client.apiCall(
      "agents.sessions.setStatus",
      request,
    );
    if (
      !warnedMissingStopSubscription &&
      (response.warning === MISSING_STOP_SUBSCRIPTION ||
        response.response_metadata?.warnings?.includes(MISSING_STOP_SUBSCRIPTION))
    ) {
      warnedMissingStopSubscription = true;
      (params.runtime ?? defaultRuntime).log?.(
        warn(
          "Slack's Stop button is unavailable until the app subscribes to agent_session_stopped. See https://docs.openclaw.ai/channels/slack#additional-manifest-settings",
        ),
      );
    }
    return response.ok ? { ok: true, title: response.title } : { ok: false };
  } catch (error) {
    const code = slackErrorCode(error);
    if (code && NOT_AGENT_APP_CODES.has(code)) {
      agentSessionsUnsupported = true;
      return await setAssistantThreadStatus({ ...params, threadTs: params.threadTs });
    }
    logVerbose(
      `slack status update failed for channel ${params.channelId}: ${formatSlackError(error)}`,
    );
    return { ok: false };
  }
}

export async function renameSlackSession(params: {
  client: WebClient;
  channelId: string;
  threadTs: string;
  title: string;
  token?: string;
}): Promise<boolean> {
  const request = {
    channel_id: params.channelId,
    thread_ts: params.threadTs,
    title: truncateUtf16Safe(params.title, 200),
    ...(params.token ? { token: params.token } : {}),
  } satisfies AgentsSessionsRenameArguments;
  try {
    const response = await params.client.apiCall("agents.sessions.rename", request);
    return response.ok;
  } catch (error) {
    logVerbose(
      `slack session rename failed for channel ${params.channelId}: ${formatSlackError(error)}`,
    );
    return false;
  }
}
