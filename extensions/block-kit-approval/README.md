# Block Kit Approval

Slack Block Kit approval flow for unknown senders.

When `dmPolicy: "pairing"` is enabled, an unknown user DMing Archi triggers a
Block Kit DM to the operator (`operatorSlackUserId`) with **Approve** /
**Deny** buttons. Approving adds the sender to the Slack allowlist; denying
sends them a polite refusal.

See `PLAN.md` for the full design and verification plan.

## Configuration

Set `operatorSlackUserId` in the plugin config (e.g. via `openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "block-kit-approval": {
        "config": {
          "operatorSlackUserId": "U09T98PGUPJ"
        }
      }
    }
  }
}
```

## Local development

The plugin is auto-discovered by OpenClaw at startup via `openclaw.plugin.json`.
After editing, restart the OpenClaw process to reload.

Verify activation:

```sh
openclaw plugins list | rg block-kit-approval
```

## Files

| File                     | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `openclaw.plugin.json`   | Plugin manifest (id, activation, config schema)        |
| `index.ts`               | `definePluginEntry` — registers handlers on startup    |
| `pending-store.ts`       | In-memory map of pending approvals (lost on restart)   |
| `owner-notify.ts`        | Builds + sends Block Kit DM to the operator            |
| `interactive-handler.ts` | Handles Approve/Deny button clicks (`bka:` namespace)  |
| `allowlist-mutate.ts`    | Wraps `approveChannelPairingCode` for the approve path |
| `messages.ts`            | All user-visible copy in one place                     |
