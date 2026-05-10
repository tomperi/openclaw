# block-kit-approval — Handoff

Branch: `tom/block-kit-approval` @ `3180213c44` (8 commits ahead of `origin/main`).

## State of the world

- **Daemon**: launchd-managed `ai.openclaw.gateway`, running fresh dist with the plugin loaded. Verify in `~/.openclaw/logs/gateway.log` for the `http server listening (10 plugins: ... block-kit-approval ...)` line.
- **Config**: `dmPolicy: "pairing"` and `plugins.entries.block-kit-approval.config.operatorSlackUserId: "U09T98PGUPJ"` in `~/.openclaw/openclaw.json`.
- **Working tree noise (do not commit)**: `extensions/canvas/src/host/a2ui/.bundle.hash` (build artifact), `skills/gh-triage/` (unrelated WIP).
- **Stash**: `stash@{0}` holds `wip: agent-defaults schema (auto-stashed for block-kit-approval branch)` — do not pop until this branch ships.

## Commits

| Hash         | What                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1036ceb8af` | docs: implementation plan (preexisting on branch)                                                                                                                           |
| `3bb368931e` | scaffold 7 stub files (skipped `package.json` — `device-pair` reference has none)                                                                                           |
| `5f15026a36` | tests for `pending-store` + add to `vitest.extension-misc-paths.mjs`                                                                                                        |
| `88033330d6` | build & send owner approval card via `sendMessageSlack`                                                                                                                     |
| `1590ffdfd8` | **upstream-PR candidate** — `slack` emits `pairing-request-created` via new `pairing-events.ts` listener registry; `dm-auth.ts` notifies in `onCreated`                     |
| `7a3b9b2043` | plugin subscribes to event + registers `bka` interactive handler                                                                                                            |
| `59671782b2` | wire approve/deny: `approveChannelPairingCode` + `sendMessageSlack` reply + `editMessage` resolved card + `pendingStore.remove`                                             |
| `3180213c44` | **bug fix** — dropped button `value` field (Slack dispatcher concatenates `actionId:value`, was producing `reqId="T5PBS79X:T5PBS79X"`); plugin-level dedupe by `event.code` |

## Architectural deviations from PLAN.md

- **No `package.json`** — canonical reference `device-pair` has none; `pnpm-workspace.yaml` only includes `.` and `ui`. Plugin is discovered via `openclaw.plugin.json` alone.
- **`enqueueSystemEvent` doesn't exist as the plan envisioned** — that helper prefixes prompts, not pub/sub. Built a minimal listener registry in `extensions/slack/src/monitor/pairing-events.ts` instead. Same shape, same effect.
- **Cross-extension imports introduced**: `block-kit-approval` imports `sendMessageSlack` from `../slack/src/send.runtime.js` and `subscribeToPairingRequestCreated` from `../slack/src/monitor/pairing-events.runtime.js`. Per-plan acceptance.
- **`originalText` deferred** — would require threading through `authorizeSlackDirectMessage` call sites. Card shows sender + email + reqId only.
- **Public API path**: used `api.registerInteractiveHandler` on `OpenClawPluginApi` (the plan referenced lower-level `registerPluginInteractiveHandler`, which is core-only).
- **Deny does not delete the underlying pairing-store entry** — no public delete API exists; the entry in `~/.openclaw/credentials/<channel>-pairing.json` lingers until TTL/restart. The plugin's in-memory store is cleared.

## Verification status

- `tsc --noEmit -p tsconfig.json` clean at every step.
- `pnpm build` produces `dist/extensions/block-kit-approval/` and `dist/pairing-events-*.js` (slack module).
- Daemon starts with the plugin in the listening list.
- **Live flow tested once with the bug**: coworker (`U05UDEWL0AG` Gil Portnoy) DM'd → card rendered correctly, but the deny-click resolve was a silent no-op due to the `value` field bug. The fix is in `3180213c44`. **Re-test pending.**

## What needs doing next session

### Required to call Phase 1 done

1. **Re-test the approve & deny flow** end-to-end with the bug fix. Either:
   - Delete the lingering entry — `jq '.requests = []' ~/.openclaw/credentials/slack-pairing.json | sponge ~/.openclaw/credentials/slack-pairing.json`, then have Gil re-DM, OR
   - Test with a different unknown sender.

   Confirm: card rendered → Approve → coworker DM'd "you've been approved" → card edits to ✅ → next message goes through normally → `~/.openclaw/credentials/slack-default-allowFrom.json` contains the user. Same shape for Deny.

2. **`vitest run`** the new `pending-store.test.ts` once the `@openclaw/fs-safe` install issue is sorted. Today's `pnpm install` hung in `kevent` for 73 min with no progress; was killed. Build worked anyway from cached `node_modules`.

### Open questions from PLAN.md (still unanswered)

1. Operator source — is `plugins.entries.block-kit-approval.config.operatorSlackUserId` the right place, or read from `commands.ownerAllowFrom[0]`? Currently set explicitly in `openclaw.json`.
2. Thread `originalText` through `dm-auth.ts` (clean) vs `conversations.history` lookup (less invasive).
3. Multiple operators — current design picks one. Decide first-click-wins vs broadcast-to-all.

### Deferred (Phase 2+)

- **Group-message-from-unknown approval** — requires extending `groupPolicy` schema to accept `"pairing"`. The coworker-in-`#archi-sandbox` scenario was the motivating use case for raising this.
- **Channel-invite approval** (`member_joined_channel` event handler).
- **Audit log** of approval decisions.

### Upstream-PR candidate

Commit `1590ffdfd8` (`feat(slack): emit pairing-request-created event for plugin subscribers`) is intentionally isolated — 3 files, 62 insertions — and stands alone with no fork-specific deps. Cherry-pickable to `openclaw/openclaw` as a small, generally-useful change.

### Separate refactor we discussed but didn't start

Move pairing-store from `~/.openclaw/credentials/` to `~/.openclaw/state/pairing/`. The current location is named "credentials" because `resolvePairingCredentialsDir` reuses `resolveOAuthDir`, but the slack pairing store is just transient state and the allow-from list is a permission list — neither is a credential.

Scope sketched:

- 2 production files (`pairing-store.ts`, `allow-from-store-file.ts`)
- 7 test files (`allow-from-store-file.test.ts`, `pairing-store.test.ts`, `doctor-state-integrity.ts`, `doctor-config-flow.test.ts`, `doctor-state-migrations.test.ts`, `infra/state-migrations.test.ts`, `security/fix.test.ts`)
- 76 doc references
- Integrate with `src/infra/state-migrations.ts` for the upgrade path

Not started — revisit if you decide it's worth the upstream churn.

### Pre-existing issues surfaced (not in scope here)

- `[plugins] canvas failed during register: api.registerHostedMediaResolver is not a function` (`gateway.err.log:38810`).
- `pnpm install` hangs in `kevent` post-install for 70+ min (no children, no progress) — unclear cause; build works fine without completing it.
- `auth.profiles.anthropic:tom-token` was removed from `openclaw.json` by the daemon during one of today's restarts; benign but noted.

## Files of interest

- `extensions/block-kit-approval/` — plugin source (7 files + this handoff + `PLAN.md`)
- `extensions/slack/src/monitor/pairing-events.ts` — new event registry (slack)
- `extensions/slack/src/monitor/pairing-events.runtime.ts` — public re-export
- `extensions/slack/src/monitor/dm-auth.ts` — modified to call `notifyPairingRequestCreated` in `onCreated`
- `test/vitest/vitest.extension-misc-paths.mjs` — added `extensions/block-kit-approval` to misc roots
- `~/.openclaw/openclaw.json` — `dmPolicy: "pairing"` and `plugins.entries.block-kit-approval` config
- `~/.openclaw/credentials/slack-pairing.json` — lingering entry from the failed deny test (delete before re-testing with same sender)
