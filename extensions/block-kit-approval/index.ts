import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "block-kit-approval",
  name: "Block Kit Approval",
  description: "Approve unknown Slack senders via Block Kit DM to operator.",
  register(_api: OpenClawPluginApi) {
    // Wired in subsequent steps:
    //   step 4: subscribe to "slack:pairing-request-created" system event
    //   step 5: register Slack interactive handler (namespace="bka")
    //   step 6: invoke approveChannelPairingCode + notifyPairingApproved on click
  },
});
