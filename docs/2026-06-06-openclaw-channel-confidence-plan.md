# OpenClaw Channel Confidence Plan

Date: 2026-06-06

## Goal

Increase confidence that an installed `openclaw-groupme` package works as an OpenClaw channel plugin, not just as a collection of GroupMe API helper functions.

This plan focuses on the next three confidence layers:

1. OpenClaw CLI installed-channel smoke tests
2. Live plugin outbound smoke tests
3. Future live inbound callback smoke test ideas

The reference OpenClaw checkout at `~/Local/openclaw` was checked against `v2026.6.1` (`2e08f0f422`). The current plugin branch already has useful unit, integration, package, install, webhook, onboarding, and raw GroupMe API live tests. The remaining gap is proving the OpenClaw-facing channel surface behaves as a user would expect after installation.

## Implementation Status

Implemented in this branch:

- The deterministic OpenClaw CLI smoke now installs the packed plugin, verifies channel catalog discovery, configures the channel with `openclaw channels add`, checks channel status, and dry-runs `openclaw message send --channel groupme`.
- The low-level live credential probe has been renamed to `tests/live/groupme-api-live.test.ts`.
- A new manual live plugin outbound smoke has been added at `tests/live/groupme-plugin-outbound-live.test.ts`. It installs the packed plugin into an isolated OpenClaw home, configures live credentials as env-backed SecretRefs, and sends through the public `openclaw message send --channel groupme` path.
- The manual `Live Smoke` workflow now runs the API live smoke first, then the plugin outbound live smoke.

Local verification skips the live tests unless `GROUPME_LIVE_ACCESS_TOKEN`, `GROUPME_LIVE_BOT_ID`, and `GROUPME_LIVE_GROUP_ID` are exported. The actual live GroupMe post is expected to run through the manual GitHub Actions workflow because the credentials are stored as repository secrets.

## Current Findings

OpenClaw v2026.6.1 can install and inspect this plugin from the packed tarball:

```bash
openclaw plugins install ./openclaw-groupme-<version>.tgz --force
openclaw plugins inspect groupme --json --runtime
```

After installation, OpenClaw reports `groupme` as a loaded channel capability, and `openclaw channels list --all --json` includes `groupme` with `installed: true`.

After installation, this also works non-interactively:

```bash
openclaw channels add --channel groupme --token fake-bot --account default --name Probe
openclaw channels list --json
openclaw channels status --channel groupme --json
```

`openclaw message send --channel groupme ...` reports `Unknown channel: groupme` when the plugin is installed but no `channels.groupme` config exists yet. After `openclaw channels add --channel groupme ...`, `openclaw message send --channel groupme --target <group-id> --message <text> --dry-run --json` succeeds. The message CLI path should therefore be included in the installed-channel smoke after channel setup, not immediately after plugin install.

## 1. OpenClaw CLI Installed-Channel Smoke Tests

Purpose: prove the packed plugin can be installed into a clean OpenClaw home, discovered as a channel, configured through OpenClaw's channel setup command, and inspected without a running gateway or real GroupMe credentials.

This belongs in normal CI because it is deterministic, credential-free, and does not call GroupMe.

### Test Location

Extend the existing test:

```text
tests/integration/openclaw-cli-smoke.test.ts
```

Keep it serialized with the rest of the integration suite because packing/building mutates `dist/` and produces package artifacts.

### Environment

Each test should create an isolated temporary OpenClaw home:

```ts
{
  HOME: tempHome,
  USERPROFILE: tempHome,
  CODEX_HOME: tempHome,
  NO_COLOR: "1",
  OPENCLAW_DISABLE_BONJOUR: "1",
  VITEST: "",
  VITEST_WORKER_ID: ""
}
```

Use the repo-installed OpenClaw CLI from:

```text
node_modules/openclaw/openclaw.mjs
```

That keeps the test pinned to the `openclaw` dev dependency version.

### Assertions

Install and inspect:

- Run `npm run build`.
- Pack the plugin tarball with scripts disabled after the explicit build.
- Run `openclaw plugins install <tarball> --force`.
- Run `openclaw plugins inspect groupme --json --runtime`.
- Assert:
  - plugin id is `groupme`
  - package name is `openclaw-groupme`
  - status is `loaded`
  - channel ids include only `groupme`
  - capability list includes `{ kind: "channel", ids: ["groupme"] }`
  - config schema is present
  - runtime diagnostics contain no errors
  - dependency status reports required dependencies installed

Channel catalog discovery:

- Run `openclaw channels list --all --json`.
- Assert `chat.groupme.installed === true`.
- Assert `chat.groupme.origin === "available"`.
- This catches regressions where plugin inspection works but the channel catalog cannot see the installed external channel.

Channel setup command:

- Run `openclaw channels add --channel groupme --token fake-bot --account default --name Probe`.
- Run `openclaw config get channels.groupme --json`.
- Assert:
  - `enabled === true`
  - `name === "Probe"`
  - `botId === "fake-bot"`
- Run `openclaw channels list --json`.
- Assert:
  - `chat.groupme.installed === true`
  - `chat.groupme.origin === "configured"`
  - `chat.groupme.accounts` includes `default`

Config-only status:

- Run `openclaw channels status --channel groupme --json`.
- Do not require a gateway to be running.
- Assert:
  - command exits successfully
  - `configOnly === true`
  - `configuredChannels` includes `groupme`
- This proves the status command accepts the dynamically installed channel id and can at least report local config.

Message send dry run:

- Run `openclaw message send --channel groupme --target 123 --message probe --dry-run --json` after `channels add`.
- Assert:
  - command exits successfully
  - `channel === "groupme"`
  - `action === "send"`
  - `dryRun === true`
  - `payload.to === "123"`
- This proves the public message CLI can select the dynamically installed GroupMe channel once it is configured.

Installed but unconfigured behavior:

- Optionally assert that `message send` before `channels add` fails with `Unknown channel: groupme`.
- Treat that as expected behavior, not an upstream bug: the message CLI preloads configured channels for message actions.

### Acceptance Criteria

This layer is complete when a clean CI run proves:

- the npm package artifact installs into OpenClaw
- OpenClaw runtime inspection loads the plugin
- OpenClaw channel catalog sees `groupme`
- OpenClaw channel setup writes a usable `channels.groupme` config section
- OpenClaw channel status recognizes the configured external channel
- OpenClaw message send dry-run recognizes the configured external channel

No Docker is needed for this layer.

## 2. Live Plugin Outbound Smoke Tests

Purpose: prove the GroupMe plugin's OpenClaw channel outbound surface can send a real message to the live configured GroupMe group.

This is different from the current live test. The current live test calls GroupMe's REST API directly, so it mostly proves the secrets and GroupMe API are working. The proposed live plugin outbound smoke should route through the plugin's channel object and runtime-facing outbound contract.

This should stay manual-only because it uses real GroupMe credentials and posts to a real group.

### Test Location

Use a live test that is separate from the raw API credential probe:

```text
tests/live/groupme-plugin-outbound-live.test.ts
```

The low-level credential probe is named so its scope is explicit:

```text
tests/live/groupme-api-live.test.ts
tests/live/groupme-plugin-outbound-live.test.ts
```

`groupme-api-live.test.ts` should only prove the repository secrets can read the configured GroupMe group and post through the configured bot. `groupme-plugin-outbound-live.test.ts` should prove the installed OpenClaw channel path can send through the plugin.

### Required Secrets

Use the existing secrets:

```text
GROUPME_LIVE_ACCESS_TOKEN
GROUPME_LIVE_BOT_ID
GROUPME_LIVE_GROUP_ID
```

No personal developer token is required in normal CI. The GitHub repository secrets are enough for the manual workflow.

Local contributors can opt in by exporting the same variables. Tests should skip cleanly when any required secret is missing.

### Harness

Use the public OpenClaw CLI from an isolated installed-plugin home, with credentials configured as env-backed SecretRefs:

```bash
openclaw plugins install ./openclaw-groupme-<version>.tgz --force
openclaw channels add --channel groupme --token placeholder --account default --name "Live Smoke"
openclaw config set channels.groupme.botId --ref-source env --ref-provider default --ref-id GROUPME_LIVE_BOT_ID
openclaw config set channels.groupme.accessToken --ref-source env --ref-provider default --ref-id GROUPME_LIVE_ACCESS_TOKEN
openclaw config set channels.groupme.groupId "$GROUPME_LIVE_GROUP_ID"
openclaw message send --channel groupme --target "$GROUPME_LIVE_GROUP_ID" --message "openclaw-groupme plugin outbound live <run-id>" --json
```

This is the strongest outbound smoke that does not require a running gateway because it exercises:

- package install into OpenClaw
- channel setup
- config loading and secret resolution
- message CLI channel selection
- OpenClaw message action runner
- plugin outbound adapter
- GroupMe Bot API post

The implementation should generate or patch the isolated OpenClaw config with SecretRef objects for `botId` and `accessToken` instead of writing plaintext credentials to disk. `groupId` is not a secret and can be written directly. If `channels add --token env:...` does not produce the exact SecretRef object needed, write the isolated config file through the test harness and then invoke `openclaw message send`.

### Non-Live Debug Harness

Do not add a required live `deliverOutboundPayloads` test. The public CLI live smoke is the required outbound confidence layer because it exercises the user-facing path and avoids depending on OpenClaw's compatibility/deprecated outbound substrate.

If debugging requires a narrower harness, use it as a deterministic integration test against a fake GroupMe HTTP server, not as an additional live smoke. Possible debug imports:

```ts
import { deliverOutboundPayloads } from "openclaw/plugin-sdk/outbound-runtime";
import {
  createPluginRuntimeMock,
  createTestRegistry,
  setActivePluginRegistry,
} from "openclaw/plugin-sdk/channel-test-helpers";
import { groupmePlugin } from "../../dist/channel-plugin-api.js";
import { setGroupMeRuntime } from "../../dist/runtime-setter-api.js";
```

The exact import paths should be validated against the installed `openclaw@2026.6.1` exports before implementation. If a helper is not exported from the published package, use the narrower available exported subpath or keep the harness local.

The deterministic debug test should:

- Build the plugin before running live tests.
- Import `dist/channel-plugin-api.js`.
- Import `dist/runtime-setter-api.js`.
- Create a minimal `PluginRuntime` mock with:
  - `channel.text.chunkMarkdownText`
  - `channel.media.fetchRemoteMedia` if testing media later
  - logging methods, if required by OpenClaw helpers
- Call `setGroupMeRuntime(runtimeMock)`.
- Register `groupmePlugin` in an active OpenClaw plugin registry if using `deliverOutboundPayloads`.
- Build a config object:

```ts
{
  channels: {
    groupme: {
      enabled: true,
      botId: process.env.GROUPME_LIVE_BOT_ID,
      accessToken: process.env.GROUPME_LIVE_ACCESS_TOKEN,
      groupId: process.env.GROUPME_LIVE_GROUP_ID
    }
  }
}
```

- Send a unique text payload through the plugin outbound path:

```ts
await deliverOutboundPayloads({
  cfg,
  channel: "groupme",
  to: process.env.GROUPME_LIVE_GROUP_ID,
  payloads: [{ text: `openclaw-groupme plugin outbound live ${runId}` }],
  skipQueue: true
});
```

- Assert:
  - the result reports `channel: "groupme"`
  - a `messageId` is returned
  - no runtime/plugin contract error is thrown
  - the fake GroupMe Bot API receives the expected request

### Direct Adapter Fallback

If `deliverOutboundPayloads` cannot be cleanly used by an external plugin test, call the plugin's exported channel outbound adapter directly in deterministic integration tests:

```ts
await groupmePlugin.outbound.sendText({
  cfg,
  to: process.env.GROUPME_LIVE_GROUP_ID,
  text: `openclaw-groupme plugin outbound live ${runId}`,
  accountId: "default"
});
```

This is still better than the raw API test because it exercises:

- built sidecar import
- runtime singleton initialization
- account resolution
- channel target normalization
- channel outbound adapter
- `sendGroupMeText`
- GroupMe Bot API post

The CLI harness is strongest because it exercises the same entrypoint a user would run. The outbound substrate harness is useful when less process overhead is needed but OpenClaw-shaped plugin dispatch still matters. The direct adapter harness should be reserved for debugging or as a narrow fallback.

### Media Live Smoke

Do not include image upload in the initial plugin outbound live smoke. Keep the first live plugin outbound test text-only so failures are easy to diagnose.

Once the text path is stable, add a separate optional live media test:

```text
tests/live/groupme-plugin-media-live.test.ts
```

That test should verify:

- remote image download through the plugin media policy
- GroupMe image service upload
- Bot API post with `picture_url`

It should have its own script, for example:

```json
{
  "test:live:plugin-media": "vitest run tests/live/groupme-plugin-media-live.test.ts"
}
```

The live workflow can run the media smoke after the text smoke, or keep it behind a separate manual input if the media path proves noisier.

### Manual Workflow

Keep `.github/workflows/live-smoke.yml` manual-only:

```yaml
on:
  workflow_dispatch:
```

Add a separate job or separate test script if helpful:

```json
{
  "test:live": "vitest run tests/live",
  "test:live:api": "vitest run tests/live/groupme-api-live.test.ts",
  "test:live:plugin-outbound": "vitest run tests/live/groupme-plugin-outbound-live.test.ts"
}
```

Recommended workflow order:

1. `npm ci`
2. `npm run build`
3. `npm run test:live:api`
4. `npm run test:live:plugin-outbound`
5. Optional later: `npm run test:live:plugin-media`

The API probe should run first because it fails with clearer credential diagnostics.

### Acceptance Criteria

This layer is complete when the manual live workflow proves:

- GitHub secrets can access the target GroupMe group
- the packed plugin installs under `openclaw@2026.6.1`
- OpenClaw channel setup configures the live GroupMe channel
- live credentials are supplied through env-backed SecretRefs, not plaintext config values
- the public `openclaw message send --channel groupme` path posts to GroupMe
- failure output clearly distinguishes credential failure, plugin contract failure, and GroupMe API failure

No Docker is needed for this layer.

## 3. Future Live Inbound Callback Smoke Ideas

Purpose: prove a real GroupMe message can enter OpenClaw through the plugin webhook path and trigger OpenClaw-style inbound handling.

This is the first layer that may need public network reachability. It is also the layer most likely to create operational noise, so it should be optional and deliberately manual.

### What It Should Prove

A true inbound smoke would prove:

- OpenClaw starts the GroupMe channel account lifecycle
- the plugin registers its webhook route
- GroupMe can reach that route over the public internet
- callback token validation succeeds
- replay/rate-limit/group-binding checks allow the expected live callback
- inbound processing records a session or dispatches a reply through the OpenClaw runtime
- the channel can optionally reply back to GroupMe through the plugin outbound path

### Option A: Local Gateway With Tunnel

Run OpenClaw locally in CI or on a developer machine and expose only the webhook route through a tunnel.

Possible tunnel providers:

- Cloudflare Tunnel
- Tailscale Funnel
- ngrok

Implementation outline:

- Start an isolated OpenClaw home.
- Install the packed plugin.
- Configure `channels.groupme` with:
  - live `botId`
  - live `accessToken`
  - live `groupId`
  - generated callback token
  - `publicDomain` pointing at the tunnel URL
  - `webhookPath` with a unique run id
- Start `openclaw gateway run` in the background.
- Start the tunnel.
- Register or update the GroupMe bot callback URL.
- Send a controlled live message into the GroupMe group.
- Wait for a runtime-observable signal:
  - channel activity timestamp
  - session record
  - webhook HTTP log
  - reply delivery
- Restore the previous bot callback URL at the end.

Tradeoffs:

- Strong confidence.
- More moving pieces.
- Requires a tunnel token or a preconfigured tunnel.
- Must be careful to restore GroupMe bot callback state.

### Option B: Reusable Staging OpenClaw Gateway

Keep a small staging OpenClaw instance running with this plugin installed.

Implementation outline:

- Deploy OpenClaw with the current plugin tarball or branch artifact.
- Configure the live GroupMe bot callback to the staging gateway.
- Trigger the smoke by sending a unique message to the test group.
- Query staging logs, health, status, or session records to verify receipt.
- Optionally assert a bot reply appears in GroupMe.

Tradeoffs:

- Strongest user-like confidence.
- Operationally heavier.
- Requires lifecycle management for the staging instance.
- Needs clear ownership of secrets, logs, and cleanup.

### Option C: Synthetic Public Webhook Receiver

Expose only the plugin webhook handler in a tiny test server instead of starting the full OpenClaw gateway.

Implementation outline:

- Start a minimal Node HTTP server.
- Mount `createGroupMeWebhookHandler()` with a fake `PluginRuntime`.
- Expose the server through a tunnel.
- Temporarily point the GroupMe bot callback URL at the tunnel URL.
- Send a real GroupMe message.
- Assert the fake runtime observed the inbound envelope.

Tradeoffs:

- Lighter than full OpenClaw.
- Tests real GroupMe callback delivery and the plugin inbound pipeline.
- Does not prove full OpenClaw gateway lifecycle or session persistence.
- A good intermediate step before Option A or B.

### Safety Requirements

Any live inbound test should:

- be manual-only
- use a dedicated test GroupMe group
- generate a unique callback path and callback token per run
- restore the previous bot callback URL
- redact tokens from logs
- time out quickly
- avoid replying to arbitrary user messages unless the run id matches
- use concurrency controls so two live inbound runs cannot fight over the same bot callback URL

### Recommended Future Order

1. Keep #1 in normal CI because it is deterministic and credential-free.
2. Keep #2 in the manual live workflow because it uses real GroupMe credentials and posts to a real group.
3. Add Option C for #3 as the first inbound live test.
4. Move to Option A or B only after Option C proves the bot callback lifecycle is manageable.

## Resolved Decisions

- Rename the raw API live test to `groupme-api-live.test.ts`.
- Configure live plugin outbound credentials through env-backed SecretRefs. Do not write plaintext `botId` or `accessToken` values to the isolated OpenClaw config.
- Use the public `openclaw message send --channel groupme` path as the required live plugin outbound smoke. Do not add a required live `deliverOutboundPayloads` test.
- Keep the initial live plugin outbound smoke text-only. Add image upload as a separate future live media smoke test.
