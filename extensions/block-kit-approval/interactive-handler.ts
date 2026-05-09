import type { PluginInteractiveHandlerRegistration } from "../../src/plugins/types.js";

export const interactiveHandler: PluginInteractiveHandlerRegistration = {
  channel: "slack",
  namespace: "bka",
  handler: async (_ctx) => {
    return { handled: false };
  },
};
