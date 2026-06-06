# Integration Testing Plan

Date: 2026-06-06

## Goal

Build confidence that `openclaw-groupme` installs, loads, and behaves correctly across three test categories:

1. Unit Tests
2. Integration Tests
3. Live Smoke Tests

The intent is to keep normal CI deterministic and credential-free while still providing an optional path to verify real GroupMe behavior before releases.

## Implementation Status

Implemented in this branch:

- Unit tests have been moved to `tests/unit/`, and `npm test` now runs the unit suite.
- Integration tests live under `tests/integration/` and run in normal `npm run check`.
- Package contract tests verify the packed npm artifact includes the compiled OpenClaw runtime entrypoints, source sidecars, `openclaw.plugin.json`, and manifest compatibility fields.
- Install smoke tests pack the plugin, install it into a clean temporary project with OpenClaw, and import the installed runtime/setup/channel/secret sidecars.
- Plugin contract tests import the built entrypoints and assert the GroupMe channel capability, setup adapter, secret contract, and config schema runtime contract.
- GroupMe HTTP boundary tests use local HTTP servers to verify request method, path, query, headers, and JSON/body shape for group listing, bot creation, outbound bot posts, and image uploads.
- Webhook-flow integration tests mount the real webhook handler on a local HTTP server and move accepted callbacks through the real inbound/session/dispatch path with a fake OpenClaw runtime.
- Onboarding HTTP-boundary tests run the real setup wizard adapter against fake GroupMe `/groups` and `/bots` endpoints.
- OpenClaw CLI smoke tests pack the plugin, install it into an isolated temporary OpenClaw home, inspect it through `openclaw plugins inspect --json --runtime groupme`, configure it with `openclaw channels add`, verify channel status/listing, and dry-run `openclaw message send --channel groupme`.
- Live smoke tests live under `tests/live/`, skip without credentials, and post to GroupMe only when explicitly run with the live secrets.
- A manual-only `Live Smoke` GitHub Actions workflow runs the GroupMe API live smoke first, then the plugin outbound live smoke, with the `groupme-live-smoke` environment and a concurrency guard.

Still good candidates for later expansion:

- A richer reply-delivery webhook test that lets the fake OpenClaw runtime call the reply `deliver` callback against a fake GroupMe Bot API.
- A `configureWhenConfigured` onboarding integration path for changing groups and registering a replacement bot.
- Optional live image upload or bot creation/deletion smoke tests, kept separate from the basic outbound-send live check.

## Test Categories

### 1. Unit Tests

Unit tests cover isolated behavior inside a single module or narrow collaboration boundary. They should be fast, deterministic, and free of real network calls.

Planned structure:

```text
tests/
  unit/
    accounts.test.ts
    channel.test.ts
    config-schema.test.ts
    groupme-api.test.ts
    history.test.ts
    inbound.*.test.ts
    monitor.test.ts
    normalize.test.ts
    onboarding.test.ts
    parse.test.ts
    policy.test.ts
    rate-limit.test.ts
    replay-cache.test.ts
    secret-contract.test.ts
    security.test.ts
    send.test.ts
    setup.test.ts
```

Migration tasks:

- Move all current test files from `tests/*.test.ts` into `tests/unit/`.
- Update relative imports from `../src/...` to `../../src/...`.
- Keep the current `npm test` behavior focused on unit tests at first.
- Preserve current coverage thresholds and coverage reporting.
- Keep existing focused tests useful; do not replace behavior assertions with broad snapshots.

Recommended script updates:

```json
{
  "test": "vitest run tests/unit",
  "test:unit": "vitest run tests/unit",
  "test:coverage": "vitest run tests/unit --coverage"
}
```

### 2. Integration Tests

Integration tests verify real boundaries without requiring real GroupMe credentials or a full OpenClaw deployment.

Planned structure:

```text
tests/
  integration/
    package-contract.test.ts
    install-smoke.test.ts
    openclaw-cli-smoke.test.ts
    plugin-contract.test.ts
    webhook-flow.test.ts
    groupme-http-boundary.test.ts
    onboarding-http-boundary.test.ts
```

Recommended script:

```json
{
  "test:integration": "vitest run tests/integration"
}
```

Integration tests should run in normal CI on Node 22 and 24.

#### Package Contract Test

Purpose: prove the package artifact contains what OpenClaw and ClawHub need.

Implementation:

- Run `npm run build`.
- Run `npm pack --json` from the test or CI step.
- Inspect the generated tarball contents.
- Assert the package includes:
  - `package/openclaw.plugin.json`
  - `package/dist/index.js`
  - `package/dist/setup-entry.js`
  - `package/index.ts`
  - sidecar API files listed in `package.json#files`
  - expected source files under `package/src/`
- Read packaged `package/package.json`.
- Assert:
  - `openclaw.extensions` points to an existing packaged file.
  - `openclaw.setupEntry` points to an existing packaged file.
  - `openclaw.compat.pluginApi` is compatible with `>=2026.6.1`.
  - `peerDependencies.openclaw` is compatible with `>=2026.6.1`.
  - `engines.node` stays aligned with CI.

Notes:

- This can be implemented with Node's `child_process`, `fs`, and `tar` package if added as a dev dependency, or by shelling out to `npm pack --dry-run --json`.
- Prefer a test that inspects the real tarball, not only local files.

#### Install Smoke Test

Purpose: prove a consumer can install and load the packed plugin.

Implementation:

- Create a temporary directory under the OS temp folder.
- Run `npm init -y`.
- Install the packed tarball plus `openclaw@2026.6.1`.
- Run a small Node script from that temp project.
- Assert imports work from the installed package:
  - `openclaw-groupme/dist/index.js`
  - `openclaw-groupme/dist/setup-entry.js`
  - any sidecar entrypoints that OpenClaw expects to load directly
- Assert plugin metadata is present:
  - channel id is `groupme`
  - setup entry exists
  - secret contract exposes `botId`, `accessToken`, and `callbackToken`

Notes:

- This does not require Docker.
- This does not require a full OpenClaw deployment.
- This catches package layout regressions that normal unit tests miss.

#### Plugin Contract Test

Purpose: prove the plugin conforms to OpenClaw's channel plugin contract.

Implementation:

- Import the built plugin entrypoint.
- If OpenClaw exposes a plugin loader or inspection API, use that API.
- Otherwise, use a lightweight contract harness that asserts:
  - plugin registration succeeds
  - channel id is `groupme`
  - config schema accepts modern config
  - config schema accepts OpenClaw `SecretInput` references
  - setup adapter exists
  - onboarding adapter exists
  - gateway start registers a webhook route
  - status snapshot builder handles unresolved secret references safely

Follow-up research:

- Inspect OpenClaw `v2026.6.1` for a public plugin loader, plugin inspector, or SDK test helper.
- If available, prefer OpenClaw's loader over a custom local harness.

#### Webhook Flow Integration Test

Purpose: exercise the inbound webhook path using real HTTP requests and a fake runtime.

Implementation:

- Start a local `node:http` server inside the test.
- Mount `createGroupMeWebhookHandler()` at a configured path.
- Build a fake `PluginRuntime` with the minimal methods needed by inbound processing.
- Send real `fetch()` requests to the local server.
- Assert:
  - non-POST requests return `405`.
  - missing or invalid callback token is rejected.
  - valid GroupMe callback payload returns `200`.
  - accepted webhook schedules inbound processing.
  - bot/system/empty messages are ignored.
  - replayed payloads are deduplicated.
  - group binding rejects the wrong `group_id`.
  - per-IP and per-sender rate limits are enforced.

Notes:

- This test should use real `Request`/`Response` and HTTP serialization.
- It should not call GroupMe.
- It should not require Docker.

#### GroupMe HTTP Boundary Test

Purpose: test outbound GroupMe API behavior against HTTP-shaped endpoints instead of only function mocks.

Implementation options:

- Add internal base URL overrides:

```ts
const GROUPME_API_BASE =
  process.env.GROUPME_API_BASE_URL ?? "https://api.groupme.com/v3";

const GROUPME_IMAGE_SERVICE =
  process.env.GROUPME_IMAGE_SERVICE_URL ?? "https://image.groupme.com";
```

- Start local fake HTTP servers for:
  - Bot API `/bots/post`
  - Image Service `/pictures`
  - remote media download URL
- Call real send helpers.
- Assert:
  - outbound text sends `POST /bots/post`
  - body contains `bot_id` and `text`
  - media flow downloads remote media, uploads it, then posts with `picture_url`
  - error responses are surfaced clearly
  - oversized or invalid media is rejected before posting

Notes:

- Existing `fetchFn` injection in `send.ts` already supports a lot of this.
- A local server catches URL/method/body mistakes better than a bare `vi.fn()`.

#### Onboarding HTTP Boundary Test

Purpose: verify onboarding against fake GroupMe API HTTP endpoints.

Implementation:

- Add testable base URL injection for `src/groupme-api.ts`.
- Start a local fake GroupMe API server.
- Serve:
  - `/groups`
  - `/bots`
- Run onboarding with a fake prompter.
- Assert:
  - groups request includes the access token
  - selected group is used
  - bot creation request includes `name`, `group_id`, and callback URL
  - callback URL includes public domain, webhook path, and `k` token
  - saved config keeps `webhookPath` and `callbackToken` separate

## 3. Live Smoke Tests

Live smoke tests call the real GroupMe API. They should be optional, manually triggered, and skipped when credentials are missing.

Planned structure:

```text
tests/
  live/
    groupme-api-live.test.ts
    groupme-plugin-outbound-live.test.ts
```

Recommended scripts:

```json
{
  "test:live": "vitest run tests/live",
  "test:live:api": "vitest run tests/live/groupme-api-live.test.ts",
  "test:live:plugin-outbound": "vitest run tests/live/groupme-plugin-outbound-live.test.ts"
}
```

Required secrets:

- `GROUPME_LIVE_ACCESS_TOKEN`
- `GROUPME_LIVE_BOT_ID`
- `GROUPME_LIVE_GROUP_ID`

The live test should skip unless all required secrets are set.

Example behavior:

- Send a short text message to a private test GroupMe group.
- Include a unique run id in the message.
- Assert GroupMe returns success.
- Do not run on pull requests.
- Do not run on contributor forks.

Optional later behavior:

- Create a temporary bot in a test group.
- Register a callback URL.
- Verify bot creation and deletion if GroupMe supports cleanup cleanly.
- Exercise image upload with a tiny fixture image.

Manual GitHub Actions workflow:

```yaml
name: Live Smoke

on:
  workflow_dispatch:

jobs:
  groupme-live:
    runs-on: ubuntu-latest
    if: github.repository == 'oddrationale/openclaw-groupme'
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run test:live:api
        env:
          GROUPME_LIVE_ACCESS_TOKEN: ${{ secrets.GROUPME_LIVE_ACCESS_TOKEN }}
          GROUPME_LIVE_BOT_ID: ${{ secrets.GROUPME_LIVE_BOT_ID }}
          GROUPME_LIVE_GROUP_ID: ${{ secrets.GROUPME_LIVE_GROUP_ID }}

      - run: npm run test:live:plugin-outbound
        env:
          GROUPME_LIVE_ACCESS_TOKEN: ${{ secrets.GROUPME_LIVE_ACCESS_TOKEN }}
          GROUPME_LIVE_BOT_ID: ${{ secrets.GROUPME_LIVE_BOT_ID }}
          GROUPME_LIVE_GROUP_ID: ${{ secrets.GROUPME_LIVE_GROUP_ID }}
```

## CI Plan

Normal pull request CI:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run knip
npm run test:coverage
npm pack --dry-run
```

Manual live smoke CI:

```bash
npm run build
npm run test:live
```

Recommended script shape:

```json
{
  "check": "npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run knip",
  "test": "npm run test:unit",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:live": "vitest run tests/live",
  "test:live:api": "vitest run tests/live/groupme-api-live.test.ts",
  "test:live:plugin-outbound": "vitest run tests/live/groupme-plugin-outbound-live.test.ts",
  "test:coverage": "vitest run tests/unit tests/integration --coverage"
}
```

## Docker Guidance

Docker is not required for the planned Unit Tests or Integration Tests.

Use plain Node/Vitest plus local HTTP servers for:

- webhook request/response tests
- fake GroupMe API tests
- outbound HTTP boundary tests
- package installation smoke tests

Docker may become useful only if the project later needs:

- a full OpenClaw deployment smoke test
- a reverse proxy or public tunnel
- a persistent database or queue
- a multi-service topology

Even for Live Smoke Tests, Docker does not solve the hardest problem: GroupMe webhooks require a public callback URL. Start with outbound-only live smoke tests, then consider webhook smoke tests only if the value outweighs the tunnel/deployment complexity.

## Implementation Phases

### Phase 1: Test Organization

- Create `tests/unit/`.
- Move current tests into `tests/unit/`.
- Update imports.
- Add `test:unit`, `test:integration`, and `test:live` scripts.
- Keep `npm test` mapped to unit tests.
- Update CI to run `test:unit`.

Acceptance criteria:

- Current test count is preserved.
- `npm run check` passes.
- Coverage stays at or above current thresholds.

### Phase 2: Package And Install Confidence

- Add `tests/integration/package-contract.test.ts`.
- Add `tests/integration/install-smoke.test.ts`.
- Ensure integration tests can pack and install the package in a temp directory.
- Add integration tests to normal CI.

Acceptance criteria:

- CI proves the packed tarball contains the runtime files OpenClaw will load.
- CI proves the packed tarball can be installed in a clean project.

### Phase 3: OpenClaw Plugin Contract

- Research OpenClaw `v2026.6.1` for a plugin loader or inspection API.
- Add a loader-based contract test if available.
- Otherwise add a lightweight harness that validates channel plugin shape.

Acceptance criteria:

- Test fails if the plugin cannot be registered or does not expose expected OpenClaw channel capabilities.
- Secret contracts and setup entrypoints are verified.

### Phase 4: HTTP Boundary Integration

- Add fake GroupMe API base URL overrides where needed.
- Add local HTTP server helpers under `tests/integration/helpers/`.
- Add outbound Bot API tests.
- Add image upload/media flow tests.
- Add onboarding fake GroupMe API tests.

Acceptance criteria:

- Tests verify HTTP method, path, query, headers, and JSON payload shape.
- Tests do not require real GroupMe credentials.

### Phase 5: Webhook End-To-End Local Flow

- Add local webhook server integration tests.
- Use realistic GroupMe callback fixtures.
- Use a fake OpenClaw runtime that records session/reply behavior.

Acceptance criteria:

- A valid callback moves through the full local webhook pipeline.
- Security failures are covered at the HTTP boundary.
- Runtime calls are asserted without contacting GroupMe.

### Phase 6: Live Smoke Test

- Add `tests/live/groupme-api-live.test.ts`.
- Add `tests/live/groupme-plugin-outbound-live.test.ts`.
- Add manual `Live Smoke` GitHub Actions workflow.
- Store secrets in GitHub Actions environment/repository secrets.
- Start with outbound text send only.

Acceptance criteria:

- Live smoke test is skipped without secrets.
- Manual workflow can post to a private test GroupMe group.
- No live smoke test runs automatically on pull requests.

## Resolved Decisions

### OpenClaw Loader Or Inspector

Decision: use the OpenClaw CLI plugin commands for package-level integration confidence, not OpenClaw's internal loader modules.

OpenClaw `v2026.6.1` does not expose a public package subpath for the runtime plugin loader. A direct import such as `openclaw/plugins/loader` is blocked by package exports. The package does expose the plugin SDK surfaces, and the CLI exposes plugin inspection commands:

```bash
openclaw plugins inspect --json --runtime <id>
openclaw plugins install <path-or-spec-or-plugin>
openclaw plugins validate --root <path> --entry <path>
```

Use those commands for install/load confidence:

- `npm pack` this package.
- Install the tarball into an isolated OpenClaw profile or temporary project.
- Run `openclaw plugins inspect --json --runtime groupme`.
- Assert the inspected plugin has the expected id, metadata, setup entry, channel capability, and secret contract.

Avoid importing OpenClaw internal loader files from `dist/plugins/loader.js`. They are useful implementation evidence, but not a stable contract for this plugin's CI.

### HTTP Base URL Overrides

Decision: prefer explicit dependency injection for HTTP tests; use environment variables only at process-boundary smoke layers.

For module-level integration tests, add optional parameters to low-level API helpers instead of process-global test hooks:

```ts
type GroupMeApiOptions = {
  fetchFn?: FetchLike;
  apiBaseUrl?: string;
  imageBaseUrl?: string;
};
```

Apply this pattern to:

- `fetchGroups()`
- `createBot()`
- outbound send helpers where base URLs are currently constants

Rationale:

- Explicit parameters keep tests isolated and parallel-safe.
- Tests can point one call at a local fake GroupMe server without mutating global process state.
- Production config stays clean; users do not see test-only base URL options.
- Existing `fetchFn` injection in `send.ts` already follows this direction.

Use environment variables only when the test is intentionally crossing a process boundary, such as an install smoke script or live smoke workflow:

```bash
GROUPME_LIVE_ACCESS_TOKEN=...
GROUPME_LIVE_BOT_ID=...
GROUPME_LIVE_GROUP_ID=...
```

Avoid public runtime config fields such as `groupmeApiBaseUrl` unless a real user-facing need appears.

### Node Matrix Scope

Decision: keep unit tests on both supported CI Node versions; start integration tests on both Node 22 and 24 unless runtime becomes too slow.

The package declares `engines.node: ">=22.19.0"`, so CI should prove at least one meaningful install/load path on Node 22. A good default is:

- Node 22:
  - unit tests
  - package contract test
  - install smoke test
  - OpenClaw CLI inspect smoke test
- Node 24:
  - unit tests
  - full integration suite
  - coverage
  - package contract test
  - install smoke test
  - OpenClaw CLI inspect smoke test

If the integration suite remains fast, run all normal integration tests on both Node 22 and 24. If it becomes slow, keep the broader HTTP-boundary tests on Node 24 and retain the package/install/plugin-contract smoke tests on Node 22.

Live smoke tests should run only on Node 24 unless a Node-version-specific live issue appears.

### Live Smoke GroupMe Resources

Decision: use a dedicated private GroupMe bot and group for live smoke tests.

Do not use a personal or shared real conversation. Create a private test group owned by the maintainer and a dedicated bot used only by CI/live smoke. Store only that bot's credentials in GitHub secrets.

Recommended resources:

- `GROUPME_LIVE_ACCESS_TOKEN`
- `GROUPME_LIVE_BOT_ID`
- `GROUPME_LIVE_GROUP_ID`

Recommended operational rules:

- The test group name should clearly identify it as automation-owned.
- Live smoke messages should include a unique run id and repository/branch context.
- Live smoke tests should avoid deleting or mutating unrelated GroupMe state.
- If bot creation/deletion smoke tests are added later, keep them separate from the basic outbound-send smoke test.
- Rotate the GroupMe access token if it is ever exposed in logs or copied outside GitHub secrets.

### Live Smoke Workflow Protection

Decision: use a protected GitHub Environment for live smoke tests.

The workflow should be manual-only with `workflow_dispatch`, and the secrets should live in a protected environment such as `groupme-live-smoke`.

Recommended workflow safeguards:

- Require maintainer approval before the environment is used.
- Restrict environment secrets to the live smoke workflow.
- Add `if: github.repository == 'oddrationale/openclaw-groupme'`.
- Do not run live smoke on pull requests.
- Add a concurrency group so only one live smoke run can post at a time.

Example:

```yaml
environment: groupme-live-smoke
concurrency:
  group: groupme-live-smoke
  cancel-in-progress: false
```

This keeps normal PR CI credential-free while still allowing a real API check before releases.
