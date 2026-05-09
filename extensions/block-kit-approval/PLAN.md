# block-kit-approval — Implementation Plan

Self-contained plan for a fresh session. Goal: build a Slack Block Kit approval flow so the operator (Tom) gets a DM with Approve/Deny buttons whenever an unknown user first contacts Archi, and (Phase 2) whenever Archi is invited to a new channel.

## Status

- **Branch**: `tom/block-kit-approval` (created from `origin/main` after a fresh fetch)
- **Stash**: `stash@{0}` holds prior agent-defaults WIP — do NOT pop until this branch is shipped/abandoned
- **Phase 1 only**: DM unknown-sender approval. Group-message-from-unknown and channel-invite approval are deferred (see "Out of scope").

## Decisions ratified (do not re-litigate)

1. **Single Approve button**, no scope nuance — approve = add user to both `allowFrom` (DMs) and `groupAllowFrom` (groups).
2. **Deny = polite reply** to requester ("Sorry, I'm not available to you right now") + card edits to `❌ Denied`. No "Deny + Block" button.
3. **Discard requester's first message**; the "you've been approved" reply must instruct them to re-send.
4. **Pending-request state in memory** — restarts lose pending approvals (acceptable for v1).
5. **Channel approval (Phase 2 only)**: deny = bot stays in channel but ignores all messages (channel-deny list); approve = add to channel allowlist.

## Architecture

```
Unknown user DMs Archi
        │
        ▼
extensions/slack/src/monitor/dm-auth.ts
  authorizeSlackDirectMessage()
        │
        │  policy === "pairing" branch
        ▼
  createChannelPairingChallengeIssuer({...})
  → issuePairingChallenge({sendPairingReply, ...})
        │
        │ NEW: also enqueue system event
        │ "block-kit-approval:pairing-request-created"
        ▼
        ─────────────────────────────────────
        │ block-kit-approval plugin listens │
        ─────────────────────────────────────
        │
        ▼
  pending-store.upsert({reqId, sender, originalText, ...})
  owner-notify.sendBlockKitDmToOwner({card with Approve/Deny buttons})
        │
        ▼
  Tom clicks Approve in Slack
        │
        ▼
  dispatchSlackPluginInteractiveHandler routes to
  block-kit-approval's registered handler (namespace="bka")
        │
        ▼
  on Approve:
    - call approveChannelPairingCode({channel: "slack", code})
      (which calls addChannelAllowFromStoreEntry under the hood)
    - call notifyPairingApproved (DM the requester
      "Approved — please re-send your original message")
    - editMessage on the owner card → "✅ Approved at HH:MM"
  on Deny:
    - DM the requester "Sorry, I'm not available right now"
    - editMessage on the owner card → "❌ Denied at HH:MM"
    - drop the pending request from memory
```

## Codebase findings (already verified — do NOT re-investigate)

### Internal APIs available

All in `src/pairing/pairing-store.ts` unless noted:

```ts
// Adds entry to the allowlist STATE FILE (not openclaw.json).
// Path resolved via resolveAllowFromFilePath(channel, env, accountId).
addChannelAllowFromStoreEntry(params): Promise<{changed, allowFrom}>

// Same shape, removal.
removeChannelAllowFromStoreEntry(params)

// Approves a pending pairing request by code; returns {id, entry?}.
approveChannelPairingCode({channel, code, accountId?, env?})
```

In `src/channels/plugins/pairing.ts`:

```ts
// Sends "you've been approved" message to the requester.
notifyPairingApproved({channelId, id, cfg, runtime?, pairingAdapter?})
```

### Plugin SDK

- Plugin entry pattern: `definePluginEntry({id, name, register(api)})` from `openclaw/plugin-sdk/plugin-entry`. See `extensions/device-pair/index.ts` for the canonical example.
- Workspace registration: `pnpm-workspace.yaml` includes `extensions/*`. Just create a directory and it's picked up.
- Interactive button handlers: `registerPluginInteractiveHandler(pluginId, registration)` from `src/plugins/interactive-registry.ts`. Slack already routes `block_actions` payloads via `dispatchSlackPluginInteractiveHandler` (in `extensions/slack/src/interactive-dispatch.ts`).
- Slack send/Block Kit: `sendMessageSlack` / `sendSlackMessage` exposed from `extensions/slack`'s runtime API. The `blocks` parameter is first-class.

### The unknown-sender hook point

`extensions/slack/src/monitor/dm-auth.ts:authorizeSlackDirectMessage()` is where unknown senders are routed when `dmPolicy === "pairing"`. Currently calls `createChannelPairingChallengeIssuer({sendPairingReply})` which DMs the requester with a code.

**No existing plugin event is emitted on pairing-request creation.** This is the upstream change needed.

### Pending state file

Pairing requests are stored via `upsertChannelPairingRequest` (in `extensions/slack/src/monitor/conversation.runtime.js` per the existing imports). The `code` returned can be used directly with `approveChannelPairingCode` to complete approval.

### `groupPolicy` cannot be `"pairing"`

Schema enum: `groupPolicy: "open" | "disabled" | "allowlist"`. No `"pairing"`. Group unknown-senders are silently ignored. Phase 2/3 work to extend.

## Files to create

```
extensions/block-kit-approval/
├── package.json
├── openclaw.plugin.json
├── index.ts                      # definePluginEntry, registers handlers
├── pending-store.ts              # in-memory request map
├── owner-notify.ts               # builds + sends Block Kit DM to owner
├── interactive-handler.ts        # button click handler
├── allowlist-mutate.ts           # wraps approveChannelPairingCode
├── messages.ts                   # all user-visible copy in one place
└── README.md                     # how to develop/test locally
```

### `package.json` (skeleton)

```json
{
  "name": "@openclaw/block-kit-approval",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@openclaw/plugin-sdk": "workspace:*",
    "@openclaw/slack": "workspace:*"
  }
}
```

### `openclaw.plugin.json`

```json
{
  "id": "block-kit-approval",
  "activation": { "onStartup": true },
  "enabledByDefault": true,
  "name": "Block Kit Approval",
  "description": "Approve unknown Slack senders via Block Kit DM to operator.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "operatorSlackUserId": {
        "type": "string",
        "description": "Slack user ID of the operator who receives approval requests."
      }
    },
    "required": ["operatorSlackUserId"]
  }
}
```

### `index.ts` (skeleton)

```ts
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "block-kit-approval",
  name: "Block Kit Approval",
  description: "Approve unknown Slack senders via Block Kit DM to operator.",
  register(api: OpenClawPluginApi) {
    // 1. Subscribe to system event "slack:pairing-request-created"
    //    (added by the dm-auth.ts upstream change below).
    // 2. Register Slack interactive handler with namespace="bka".
    //    Action IDs: "bka:approve:<reqId>", "bka:deny:<reqId>".
    // 3. Read operatorSlackUserId from api.pluginConfig.
  },
});
```

### `pending-store.ts` (signature)

```ts
export type PendingRequest = {
  reqId: string; // pairing code (use as-is — already unique)
  senderId: string;
  senderName?: string;
  senderEmail?: string;
  originalText?: string; // first message; may be undefined
  channel: "slack";
  accountId: string;
  createdAtMs: number;
  ownerCardChannel?: string; // Slack channel ID of the DM with operator
  ownerCardTs?: string; // message ts for editMessage later
};

export function upsert(req: PendingRequest): void;
export function get(reqId: string): PendingRequest | undefined;
export function remove(reqId: string): void;
export function attachOwnerCard(reqId: string, channel: string, ts: string): void;
```

In-memory `Map<string, PendingRequest>`. No persistence — restart loses pending.

### `owner-notify.ts` (signature)

```ts
export async function sendOwnerApprovalCard(params: {
  api: OpenClawPluginApi;
  operatorSlackUserId: string;
  request: PendingRequest;
}): Promise<{ channel: string; ts: string }>;
```

Block Kit JSON shape (target):

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🦞 New user wants to talk to Archi" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*User:* <@U…> (`U…`)" },
        { "type": "mrkdwn", "text": "*Email:* user@example.com" }
      ]
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*First message:*\n> hey archi, can you help me…" }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "style": "primary",
          "text": { "type": "plain_text", "text": "✅ Approve" },
          "action_id": "bka:approve:<reqId>",
          "value": "<reqId>"
        },
        {
          "type": "button",
          "style": "danger",
          "text": { "type": "plain_text", "text": "❌ Deny" },
          "action_id": "bka:deny:<reqId>",
          "value": "<reqId>"
        }
      ]
    }
  ]
}
```

Send via `sendMessageSlack` (or `sendSlackMessage` — confirm correct export at build time) targeting `operatorSlackUserId`'s DM channel. Capture returned `channel` + `ts` for `attachOwnerCard()`.

### `interactive-handler.ts` (signature)

```ts
export const interactiveHandler: SlackInteractiveHandlerRegistration = {
  pluginId: "block-kit-approval",
  channel: "slack",
  namespace: "bka",
  handle: async (ctx) => {
    const [op, reqId] = ctx.interaction.actionId.split(":").slice(1);
    // ctx.interaction.actionId: "bka:approve:<reqId>" or "bka:deny:<reqId>"
    // Auth check: ctx.senderId === operatorSlackUserId (read from api.pluginConfig)
    // op === "approve":
    //   await approveChannelPairingCode({ channel: "slack", code: reqId, accountId, env: process.env })
    //   await notifyPairingApproved({ channelId: "slack", id, cfg, ... })
    //     OR send custom message via sendMessageSlack so we can include
    //     the "please re-send your original message" instruction.
    //   await ctx.respond.editMessage({ blocks: resolvedCardBlocks("approved", operatorName, ts) })
    //   pendingStore.remove(reqId)
    // op === "deny":
    //   await sendMessageSlack(senderId, denyMessage)
    //   await ctx.respond.editMessage({ blocks: resolvedCardBlocks("denied", ...) })
    //   pendingStore.remove(reqId)
    //   // Note: do NOT call approveChannelPairingCode — leaves the pending
    //   // request in the channel store; consider also removing it for hygiene
    //   // (need to find a "deletePairingRequest" API or use a TTL).
    await ctx.respond.acknowledge();
  },
};
```

Auth: only `operatorSlackUserId` may click. Anyone else clicking → ephemeral reply "Not authorized" + no state change.

### `messages.ts`

Centralize all user-visible strings:

```ts
export const APPROVED_REPLY =
  "You've been approved by the operator. Please send your original message again.";
export const DENIED_REPLY = "Sorry, I'm not available to you right now.";
export const NOT_AUTHORIZED_EPHEMERAL = "Only the operator can resolve this approval.";
export function ownerCardHeader(): string {
  return "🦞 New user wants to talk to Archi";
}
export function ownerCardResolved(
  decision: "approved" | "denied",
  operatorName: string,
  ts: Date,
): string {
  /* ... */
}
```

## Upstream change required

**File**: `extensions/slack/src/monitor/dm-auth.ts`
**Why**: Emit a system event when a pairing request is newly created so the plugin can listen.

**Approximate diff** (verify exact local shape before applying):

```diff
@@ in authorizeSlackDirectMessage, inside the dmPolicy === "pairing" branch
   if (params.ctx.dmPolicy === "pairing") {
     await createChannelPairingChallengeIssuer({
       channel: "slack",
       upsertPairingRequest: async ({ id, meta }) =>
         await upsertChannelPairingRequest({...}),
     })({
       senderId: params.senderId,
       senderIdLine: `Your Slack user id: ${params.senderId}`,
       meta: { name: senderName },
       sendPairingReply: params.sendPairingReply,
-      onCreated: () => {
-        params.log(...);
+      onCreated: ({ code }) => {
+        params.log(...);
+        // NEW: notify any plugin that wants to act on first contact.
+        enqueueSystemEvent({
+          type: "slack:pairing-request-created",
+          payload: {
+            code,
+            senderId: params.senderId,
+            senderName,
+            accountId: params.accountId,
+            // NOTE: caller must thread `originalText` (the unknown user's
+            // first message text) into authorizeSlackDirectMessage params
+            // so we can emit it here. Currently NOT passed in. Audit the
+            // call site to decide whether to add it. If too invasive,
+            // emit without and have the plugin look up the most recent
+            // message via slack API.
+          },
+        });
       },
       onReplyError: (err) => {...},
     });
     return false;
   }
```

**Caveats for the implementer:**

- `enqueueSystemEvent` import path: confirm via existing usage (search `enqueueSystemEvent` in `extensions/slack`).
- `originalText` is NOT currently in the function params — needs to be threaded in from the call site OR the plugin must do a follow-up `conversations.history` lookup. Decide based on what's cheaper. Plumbing it through is cleaner; doing a history lookup is less invasive but adds an extra API call.
- This change is a candidate for a separate upstream PR (small, generally useful). Keep it as an isolated commit so it can be cherry-picked.

## Implementation steps (ordered)

1. **Scaffold the plugin** — create the 8 files above with stubs that compile. Run `pnpm install` from repo root to register the workspace package. Verify with `pnpm -F @openclaw/block-kit-approval typecheck` (or repo-wide `pnpm typecheck`).
2. **Wire `pending-store.ts`** — pure logic, no dependencies. Add unit tests if convenient (look at `extensions/device-pair/notify.test.ts` for test style).
3. **Wire `owner-notify.ts`** — build the Block Kit JSON, send via slack runtime API. Confirm the correct send function name (likely `sendMessageSlack`). Resolve operator's DM channel via `conversations.open` if not already cached.
4. **Apply the `dm-auth.ts` upstream change** — minimal diff, separate commit, can stand alone.
5. **Wire `interactive-handler.ts`** — register via `registerPluginInteractiveHandler`. Test with a manually constructed payload first if possible.
6. **Wire allowlist + notify** — call `approveChannelPairingCode` and `notifyPairingApproved` in the approve path. For denial, send custom message; consider whether/how to drop the pending pairing request from the store (search for a delete/expire API).
7. **End-to-end manual test** — see "Verification" below.
8. **Polish** — card resolved-state edits, audit log file, any copy tweaks.

Each step should be an independent commit on `tom/block-kit-approval`. Keep the upstream `dm-auth.ts` change as its own commit so it can be cherry-picked into a PR to `origin/main`.

## Verification (manual test plan)

**Pre-conditions:**

- `dmPolicy: "allowlist"` flipped to `"pairing"` in `~/.openclaw/openclaw.json` (or test it as `"pairing"` from the start)
- Plugin enabled (`enabledByDefault: true` should suffice; verify via `openclaw plugins list`)
- `operatorSlackUserId` set in plugin config (probably under `plugins.entries.block-kit-approval.config.operatorSlackUserId`)
- Restart OpenClaw

**Approve path:**

1. From an alt Slack account (NOT Tom), DM Archi: "hey archi, test message"
2. Tom should receive a Block Kit DM in his Archi DM with sender info, the message, Approve/Deny buttons
3. Tom clicks Approve
4. Card edits to `✅ Approved by Tom at HH:MM`
5. Alt account receives DM: "You've been approved by the operator. Please send your original message again."
6. Alt account sends another message — bot responds normally
7. Verify allowlist state file now contains the alt's user ID

**Deny path:**

1. New alt account DMs Archi: "hello"
2. Tom gets card; clicks Deny
3. Card edits to `❌ Denied`
4. Alt account receives polite-deny DM
5. Alt account sends another message — bot ignores it (and ideally re-issues a new pairing card to Tom on next attempt? decide during build)

**Negative tests:**

- Non-operator clicks button → ephemeral "not authorized" message, no state change.
- Operator clicks Approve twice (race) → second click is a no-op (request already removed from store).
- Restart OpenClaw mid-flow → in-memory pending state is lost; alt account's next message creates a fresh pairing request (acceptable).

## Open questions / decisions deferred

These are NOT blockers for Phase 1 but should be answered before merging:

1. **Where does `operatorSlackUserId` config live?** Plugin-config (`plugins.entries.block-kit-approval.config`), or read from `commands.ownerAllowFrom`? Latter is DRYer; former is more explicit. Lean toward reading `commands.ownerAllowFrom[0]` and treating that as the operator (already configured for command auth).
2. **Original message text plumbing in `dm-auth.ts`** — thread it through (clean, more invasive) vs. lookup via `conversations.history` (less invasive, extra API call). Decide based on call-site count and reviewer feedback.
3. **Pending-request cleanup on Deny** — does `approveChannelPairingCode` have a sibling for delete? If not, document that denied requests linger in the store until TTL/restart. Probably acceptable.
4. **Multiple operators** — current design assumes one. If `commands.ownerAllowFrom` has multiple entries, do all get the card? First-click-wins? Defer to a follow-up.

## Out of scope for Phase 1

- Group-message-from-unknown approval (requires `groupPolicy: "pairing"` schema + auth-path changes)
- Channel-invite approval (`member_joined_channel` event handler — separate research)
- Audit log file (Phase 3)
- Revocation / list management UI

## Pointers for the implementer

- **Most useful reference plugin**: `extensions/device-pair/` — flat structure, similar surface area (pairing flow + commands), minimal dependencies. Read its `index.ts` for the `definePluginEntry` shape.
- **Slack send + Block Kit**: read `extensions/slack/src/action-runtime.ts` for `sendMessageSlack` usage; `extensions/slack/src/edit-text.ts` shows Block Kit fallback handling.
- **Existing Slack interactive handler test**: `extensions/slack/src/monitor/events/interactions.test.ts` — shows the dispatch shape expected by `dispatchSlackPluginInteractiveHandler`.
- **Pairing request storage**: `extensions/slack/src/monitor/conversation.runtime.ts` — search for `upsertChannelPairingRequest`.

## When this is shipped

- Open a separate small PR to `openclaw/openclaw` for the `dm-auth.ts` system-event addition (commit it solo on this branch first).
- The plugin itself can stay in the fork or be proposed as a contrib extension.
- Pop `stash@{0}` to restore the agent-defaults schema WIP.
- Delete this `PLAN.md` once the plugin is implemented and merged.
