import type { SlackInteractiveHandlerRegistration } from "../slack/src/interactive-dispatch.js";
import { NOT_AUTHORIZED_EPHEMERAL } from "./messages.js";

export type InteractionOp = "approve" | "deny";

export type ResolveDecision = (params: {
  op: InteractionOp;
  reqId: string;
  ctx: Parameters<SlackInteractiveHandlerRegistration["handler"]>[0];
}) => Promise<void> | void;

export function createInteractiveHandler(deps: {
  operatorSlackUserId: string;
  resolve: ResolveDecision;
}): SlackInteractiveHandlerRegistration {
  return {
    channel: "slack",
    namespace: "bka",
    handler: async (ctx) => {
      if (ctx.senderId !== deps.operatorSlackUserId) {
        await ctx.respond.reply({
          text: NOT_AUTHORIZED_EPHEMERAL,
          responseType: "ephemeral",
        });
        await ctx.respond.acknowledge();
        return { handled: true };
      }

      const parsed = parsePayload(ctx.interaction.payload);
      if (!parsed) {
        await ctx.respond.acknowledge();
        return { handled: true };
      }

      await deps.resolve({ op: parsed.op, reqId: parsed.reqId, ctx });
      await ctx.respond.acknowledge();
      return { handled: true };
    },
  };
}

function parsePayload(payload: string): { op: InteractionOp; reqId: string } | undefined {
  const colonIndex = payload.indexOf(":");
  if (colonIndex < 0) return undefined;
  const op = payload.slice(0, colonIndex);
  const reqId = payload.slice(colonIndex + 1);
  if (!reqId) return undefined;
  if (op !== "approve" && op !== "deny") return undefined;
  return { op, reqId };
}
