# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is **openclaw-groupme**, an OpenClaw channel plugin that connects GroupMe group chats to OpenClaw agents via webhooks. It receives inbound messages from GroupMe's callback API, routes them through a security pipeline, and dispatches replies back through the GroupMe Bot API.

The plugin is published to npm and ClawHub as `openclaw-groupme` and loaded by the OpenClaw runtime (>= 2026.9.7, Node >= 24.16) via `package.json#openclaw.extensions` (`./dist/index.js`) and `openclaw.setupEntry` (`./dist/setup-entry.js`). TypeScript is compiled to `dist/` by `npm run build` (run automatically by `prepack`).

## Commands

```bash
npm test                                   # Unit tests (vitest)
npm run check                              # lint + format check + typecheck + unit + integration + build + manifest check + knip
npm run test:e2e                           # Real OpenClaw gateway e2e (stub model, fake GroupMe API)
npm run typecheck                          # Type-check with tsc --noEmit
npm run manifest:sync                      # Regenerate openclaw.plugin.json channelConfigs from the zod schema
npx vitest run tests/unit/parse.test.ts    # Run a single test file
npx vitest run -t "accepts active"         # Run tests matching a name pattern
```

Live suites (`npm run test:live*`) need `GROUPME_LIVE_ACCESS_TOKEN`, `GROUPME_LIVE_BOT_ID`, and `GROUPME_LIVE_GROUP_ID`; in CI they run from the manually dispatched "GroupMe Live API and Plugin Smoke" workflow.

## Architecture

### Plugin Entry Point

`index.ts` uses `defineChannelPluginEntry` (`openclaw/plugin-sdk/channel-core`) to register the full channel plugin from `src/channel.ts` and store the `PluginRuntime` via `createPluginRuntimeStore` (`src/runtime.ts`). `setup-entry.ts` uses `defineSetupPluginEntry` with the setup-safe plugin in `src/channel.setup.ts` (metadata, config, secrets, setup contract, wizard) so disabled/unconfigured installs never load the monitor, inbound pipeline, or sender. `secret-contract-api.ts` is discovered by OpenClaw for secret-target registration.

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

After acceptance, the response is sent immediately (`200 ok`) and `src/inbound.ts` handles processing inside `runDetachedWebhookWork` (tracked across gateway drains):

- Mention detection with botName, regex patterns, and agent regexes (`src/parse.ts`)
- Sender allowlist (`allowFrom`), control-command authorization, and mention activation through `runtime.channel.inbound.ingress.resolveStable` (core channel ingress)
- History buffering for `requireMention: true` mode via `createChannelHistoryWindow` (`src/history.ts`)
- Context via `runtime.channel.inbound.buildContext` (image attachments as media facts) and dispatch via `runtime.channel.inbound.dispatch`, which records the session and delivers replies through core's durable queue (falling back to the plugin's direct `deliver`)

### Outbound

`src/send.ts` handles sending messages back to GroupMe:

- Text messages via the Bot API (`/v3/bots/post`)
- Media: download remote image (with SSRF guard + MIME + size limits) → upload to GroupMe Image Service → send with `picture_url`
- Uses `runtime.channel.media.readRemoteMediaBuffer` when the runtime is initialized, falling back to `fetchWithSsrFGuard` (`openclaw/plugin-sdk/ssrf-runtime`)
- Local (agent workspace) media only through a host-provided `mediaReadFile` (outbound context, or agent-scoped media roots on the inbound direct path)
- `src/channel.ts` exposes both the `outbound` adapter and a `message` adapter (`defineChannelMessageAdapter`) that returns receipts; the Bot API returns no message id, so ids are empty rather than fabricated

### Configuration

`src/types.ts` defines all config types. `src/config-schema.ts` provides Zod validation and config UI hints; `openclaw.plugin.json#channelConfigs.groupme` mirrors the generated JSON Schema (regenerate with `npm run manifest:sync`; `npm run manifest:check` and a unit test guard drift). `src/accounts.ts` handles multi-account resolution with config inheritance (top-level fields → named account). It does **not** read `process.env` — env-backed secrets are configured as SecretRefs and resolved by the OpenClaw runtime.

`src/security.ts` exports `resolveGroupMeSecurity()` which merges user config with secure defaults (replay enabled, rate limiting enabled, private networks blocked, secrets redacted).

### Setup and Onboarding

`src/setup-surface.ts` defines the channel-owned setup contract (`defineChannelSetupContract`) behind `openclaw channels add --channel groupme` flags; `package.json#openclaw.channel.setup.fields` must mirror `groupmeSetupFields` (a unit test checks). `src/onboarding.ts` implements the interactive setup wizard adapter. It uses `src/groupme-api.ts` to call the GroupMe REST API (`fetchGroups`, `createBot`) and guides the user through group selection and bot creation.

### Utilities

`src/normalize.ts` provides ID normalization helpers (`normalizeStringId`, `normalizeGroupMeTarget`, `looksLikeGroupMeTargetId`) used across config resolution and policy matching.

### Key Patterns

- **All imports use `.js` extensions** — required by Node16 module resolution (`"type": "module"`)
- **Security config uses a "resolve with defaults" pattern** — `resolveGroupMeSecurity()` fills in all defaults so downstream code never handles `undefined` security fields
- **`PluginRuntime` is accessed via `getGroupMeRuntime()`** — a `createPluginRuntimeStore` slot set at plugin registration; test files mock `src/runtime.ts` to inject fakes
- **Import only typed, non-deprecated SDK subpaths** — OpenClaw retires deprecated subpaths on published dates (see its `docs/plugins/sdk-migration`); prefer focused subpaths over broad barrels such as `config-runtime`, `infra-runtime`, or `security-runtime`
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

| Type                                  | Version bump  | Use for                                          |
| ------------------------------------- | ------------- | ------------------------------------------------ |
| `feat:`                               | minor (0.x.0) | New features or capabilities                     |
| `fix:`                                | patch (0.0.x) | Bug fixes                                        |
| `feat!:` or `BREAKING CHANGE:` footer | major (x.0.0) | Breaking API/config changes                      |
| `docs:`                               | none          | Documentation only                               |
| `ci:`                                 | none          | CI/CD workflow changes                           |
| `chore:`                              | none          | Maintenance, deps, tooling                       |
| `refactor:`                           | none          | Code changes that don't fix bugs or add features |
| `test:`                               | none          | Adding or updating tests                         |

Only `feat:`, `fix:`, and breaking changes trigger a release. Use the appropriate type so the changelog and version bump are correct.

### Release Please and Squash Merges

Release Please reads the commits that land on `main`. When GitHub squash-merges a pull request, the PR title usually becomes the final commit subject. If a PR contains release-triggering work, the PR title used for squash merge must also be a Conventional Commit.

Before merging a PR that should trigger a release, make sure the squash commit title starts with one of:

- `feat:` for new features
- `fix:` for bug fixes
- `feat!:` or another Conventional Commit with `!` for breaking changes

For example, a breaking modernization PR should be squash-merged with a title like:

```text
feat!: modernize GroupMe channel for OpenClaw 2026.6.1
```

Do not squash-merge a releasable PR with a descriptive but non-conventional title such as `Modernize GroupMe for OpenClaw 2026.6.1 and add repo tooling`, because Release Please will not recognize it as a release-triggering Conventional Commit and will skip the release.

## ClawHub Publishing

This is a ClawHub **code plugin**, not a skills plugin. Publish the same npm package artifact to ClawHub with `clawhub package publish --family code-plugin`.

Native OpenClaw plugin archives must include `openclaw.plugin.json` at the package root. Keep it listed in `package.json#files`; otherwise ClawHub rejects the packed archive with `ClawPack must contain package/openclaw.plugin.json`.

ClawHub also requires compiled JavaScript runtime output for TypeScript plugins. Keep `openclaw.extensions` pointed at `./dist/index.js`, keep `dist/**/*.js` in `package.json#files`, and let `prepack` run `npm run build` before publish/pack. The TypeScript source stays in the package for source visibility, but ClawHub validates and loads the compiled entry.

Do not use `openclaw/clawhub/.github/workflows/package-publish.yml` for this repo unless the package layout changes. That reusable workflow publishes a ClawPack source tree; this repo is npm-package-shaped and should publish the tarball generated by `npm pack`.

Do not add the `clawhub` CLI as a root dev dependency just to publish releases. Its tooling dependencies have higher Node engine requirements than this package's runtime `engines.node` contract, so keeping it out of the root package avoids surprising contributors and consumers.

For release automation, pack first and publish the generated tarball with a pinned CLI version:

```bash
TARBALL="$(npm pack)"
npx --yes clawhub@0.19.1 login --token "$CLAWHUB_TOKEN"
npx --yes clawhub@0.19.1 package publish "./${TARBALL}" --family code-plugin --manual-override-reason "GitHub Actions release publish via CLAWHUB_TOKEN"
```

For local ClawHub commands, use `npx` or `pnx` instead of requiring a global install:

```bash
npx --yes clawhub@0.19.1 package publish ./openclaw-groupme-0.4.1.tgz --family code-plugin --dry-run
```

ClawHub install docs should prefer:

```bash
openclaw plugins install clawhub:openclaw-groupme --accept-capabilities
```

Keep the npm install path documented as an explicit alternative:

```bash
openclaw plugins install npm:openclaw-groupme --accept-capabilities
```

## Dependencies

- **`zod`** (runtime) — config schema validation
- **`openclaw`** (peer, `>= 2026.9.7`) — plugin SDK, runtime APIs, security utilities (`fetchWithSsrFGuard`, `readJsonBodyWithLimit`, etc.)
- **`vitest`** (dev) — test framework
- **`typescript`** (dev) — type-checking and compilation to `dist/` during `build`/`prepack`
