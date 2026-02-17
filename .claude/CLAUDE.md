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

### Key Patterns

- **All imports use `.js` extensions** — required by Node16 module resolution (`"type": "module"`)
- **Security config uses a "resolve with defaults" pattern** — `resolveGroupMeSecurity()` fills in all defaults so downstream code never handles `undefined` security fields
- **`PluginRuntime` is accessed via `getGroupMeRuntime()`** — a module-level singleton set once at plugin registration; test files mock `src/runtime.ts` to inject fakes
- **Tests that use `vi.mock()` must mock the `src/` path** — e.g., `vi.mock("../src/runtime.js", ...)`
- **`FetchLike` is defined as an explicit function signature**, not `typeof fetch` (newer Node types add static properties to `fetch` that break assignability)

## Dependencies

- **`zod`** (runtime) — config schema validation
- **`openclaw`** (peer) — plugin SDK, runtime APIs, security utilities (`fetchWithSsrFGuard`, `readJsonBodyWithLimit`, etc.)
- **`vitest`** (dev) — test framework
- **`typescript`** (dev) — type-checking only (no compilation)
