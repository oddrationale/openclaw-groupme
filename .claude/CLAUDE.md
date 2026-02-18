# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **openclaw-groupme**, an OpenClaw channel plugin that connects GroupMe group chats to OpenClaw agents via webhooks. It receives inbound messages from GroupMe's callback API, routes them through a security pipeline, and dispatches replies back through the GroupMe Bot API.

The plugin is published to npm as `openclaw-groupme` and loaded by the OpenClaw runtime via the `openclaw.extensions` field in `package.json`, which points to `./index.ts`. OpenClaw runs the TypeScript directly — there is no build step.

## Commands

```bash
npm test                              # Run all tests (vitest)
npm run typecheck                     # Type-check with tsc --noEmit
npx vitest run tests/parse.test.ts    # Run a single test file
npx vitest run -t "accepts active"    # Run tests matching a name pattern
```

## Architecture

### Plugin Entry Point

`index.ts` registers the plugin with OpenClaw. It captures the `PluginRuntime` into a module-level singleton (`src/runtime.ts`) and registers the channel plugin object defined in `src/channel.ts`.

### Inbound Webhook Pipeline

When a GroupMe callback hits the webhook, `src/monitor.ts` runs a sequential decision pipeline via `decideWebhookRequest()`:

1. **Method check** — reject non-POST (405)
2. **Callback token auth** (`src/security.ts`) — timing-safe token verification
3. **Proxy validation** (`src/security.ts`) — CIDR-based trusted proxy, host allowlist
4. **Body parsing** — 64KB limit, 15s timeout
5. **Payload parsing** (`src/parse.ts`) — extract `GroupMeCallbackData`
6. **Message filtering** (`src/parse.ts`) — ignore bots, system messages, empty messages
7. **Group binding** (`src/security.ts`) — enforce expected group_id
8. **Replay dedup** (`src/replay-cache.ts`) — SHA256-keyed sliding TTL cache
9. **Rate limiting** (`src/rate-limit.ts`) — per-IP, per-sender, and global concurrency

After acceptance, the response is sent immediately (`200 ok`) and `src/inbound.ts` handles processing asynchronously:
- Sender access control via `allowFrom` (`src/policy.ts`)
- Mention detection with botName, regex patterns, and agent regexes (`src/parse.ts`)
- History buffering for `requireMention: true` mode (`src/history.ts`)
- Control command gating with configurable bypass security
- Session recording and reply dispatch via OpenClaw runtime APIs

### Outbound

`src/send.ts` handles sending messages back to GroupMe:
- Text messages via the Bot API (`/v3/bots/post`)
- Media: download remote image (with SSRF guard + MIME + size limits) → upload to GroupMe Image Service → send with `picture_url`
- Uses `runtime.channel.media.fetchRemoteMedia` when available, falls back to built-in `fetchWithSsrFGuard`

### Configuration

`src/types.ts` defines all config types. `src/config-schema.ts` provides Zod validation. `src/accounts.ts` handles multi-account resolution with config inheritance and env var fallback (`GROUPME_BOT_ID`, `GROUPME_ACCESS_TOKEN`, etc.).

`src/security.ts` exports `resolveGroupMeSecurity()` which merges user config with secure defaults (replay enabled, rate limiting enabled, private networks blocked, secrets redacted).

### Onboarding

`src/onboarding.ts` implements the `ChannelOnboardingAdapter` for interactive bot setup. It uses `src/groupme-api.ts` to call the GroupMe REST API (`fetchGroups`, `createBot`) and guides the user through group selection and bot creation.

### Utilities

`src/normalize.ts` provides ID normalization helpers (`normalizeStringId`, `normalizeGroupMeTarget`, `looksLikeGroupMeTargetId`) used across config resolution and policy matching.

### Key Patterns

- **All imports use `.js` extensions** — required by Node16 module resolution (`"type": "module"`)
- **Security config uses a "resolve with defaults" pattern** — `resolveGroupMeSecurity()` fills in all defaults so downstream code never handles `undefined` security fields
- **`PluginRuntime` is accessed via `getGroupMeRuntime()`** — a module-level singleton set once at plugin registration; test files mock `src/runtime.ts` to inject fakes
- **Tests that use `vi.mock()` must mock the `src/` path** — e.g., `vi.mock("../src/runtime.js", ...)`
- **`FetchLike` is defined as an explicit function signature**, not `typeof fetch` (newer Node types add static properties to `fetch` that break assignability)

## Reference Docs

`docs/references/` contains local copies of GroupMe's developer documentation. Consult these when working on API integration code (e.g., `src/send.ts`, `src/accounts.ts`) rather than guessing endpoint details:

- **`groupme-api-reference.md`** — Full REST API reference (groups, members, messages, bots, etc.). Use when adding or modifying API calls.
- **`groupme-image-service-reference.md`** — Image Service upload/download API. Use when working on media handling in `src/send.ts`.
- **`groupme-bot-tutorial.md`** — Bot registration, callback setup, and posting tutorial. Use for understanding bot lifecycle and webhook configuration.

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Release Please reads commit messages to determine version bumps and generate changelogs.

**Format:** `<type>: <description>` (lowercase type, imperative description)

| Type | Version bump | Use for |
|------|-------------|---------|
| `feat:` | minor (0.x.0) | New features or capabilities |
| `fix:` | patch (0.0.x) | Bug fixes |
| `feat!:` or `BREAKING CHANGE:` footer | major (x.0.0) | Breaking API/config changes |
| `docs:` | none | Documentation only |
| `ci:` | none | CI/CD workflow changes |
| `chore:` | none | Maintenance, deps, tooling |
| `refactor:` | none | Code changes that don't fix bugs or add features |
| `test:` | none | Adding or updating tests |

Only `feat:`, `fix:`, and breaking changes trigger a release. Use the appropriate type so the changelog and version bump are correct.

## Dependencies

- **`zod`** (runtime) — config schema validation
- **`openclaw`** (peer) — plugin SDK, runtime APIs, security utilities (`fetchWithSsrFGuard`, `readJsonBodyWithLimit`, etc.)
- **`vitest`** (dev) — test framework
- **`typescript`** (dev) — type-checking only (no compilation)
