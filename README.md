# openclaw-groupme

GroupMe channel plugin for OpenClaw (GroupMe Bot API, group chats only).

## Install

```bash
openclaw plugins install openclaw-groupme
```

Restart the gateway after installing the plugin.

## What this plugin needs

1. A GroupMe bot (from https://dev.groupme.com/bots)
2. A public HTTPS URL that can reach your OpenClaw gateway webhook endpoint
3. Your GroupMe `bot_id` (required)
4. Your GroupMe `access token` (recommended, required for image uploads)
5. A webhook callback token and expected GroupMe `group_id` (recommended)

## Step-by-step setup

1. Install plugin:

```bash
openclaw plugins install openclaw-groupme
```

2. Create a GroupMe bot:
   - Go to https://dev.groupme.com/bots
   - Create/select a bot for your target group
   - Copy the bot's `bot_id`
   - Copy your GroupMe `access token`

3. Configure OpenClaw:
   - Option A (interactive):

```bash
openclaw channels add --channel groupme
```

- Option B (manual config): add this under your OpenClaw config:

```yaml
channels:
  groupme:
    enabled: true
    botId: "YOUR_GROUPME_BOT_ID"
    accessToken: "YOUR_GROUPME_ACCESS_TOKEN"
    botName: "oddclaw"
    callbackPath: "/groupme/9f5d7c2a"
    requireMention: true
    historyLimit: 20
    security:
      callbackAuth:
        token: "REPLACE_WITH_LONG_RANDOM_SECRET"
        tokenLocation: "query"
        queryKey: "k"
        rejectStatus: 404
      groupBinding:
        expectedGroupId: "YOUR_GROUP_ID"
```

4. Point GroupMe to your webhook:
   - Callback URL format: `https://<your-public-domain><callbackPath>?k=<callback token>`
   - Example: `https://bot.example.com/groupme/9f5d7c2a?k=REPLACE_WITH_LONG_RANDOM_SECRET`
   - Set this URL in the GroupMe bot settings

5. Restart OpenClaw gateway:

```bash
openclaw gateway restart
```

6. Verify channel status:

```bash
openclaw channels status --probe
```

7. Send a test message in the GroupMe group to confirm it works.

## Response modes

The bot has two modes controlled by `requireMention`:

### Always respond (`requireMention: false`)

The bot replies to every message in the group. Best for small groups or 1:1 chats with the bot.

```yaml
channels:
  groupme:
    requireMention: false
```

### Mention only (`requireMention: true`, default)

The bot only replies when mentioned by name. But it passively reads all messages in the background — so when you do mention it, it knows what's been discussed.

Control how much conversation history the bot remembers with `historyLimit` (default: 20 messages). When you mention the bot, it sees the last `historyLimit` messages as context for its response.

```yaml
channels:
  groupme:
    requireMention: true
    historyLimit: 30
```

Set `historyLimit: 0` to disable history buffering entirely (the bot will only see the message that mentioned it).

## How mentioning works

GroupMe doesn't have native @mention support for bots. Instead, the plugin uses text-based pattern matching on the message body.

By default, the bot responds when its name appears in the message (via `botName`). You can also configure custom patterns:

```yaml
channels:
  groupme:
    botName: "oddclaw"
    mentionPatterns:
      - "@oddclaw"
      - "oddclaw"
      - "hey oddclaw"
```

Patterns are case-insensitive regex. If `mentionPatterns` is not set, the plugin falls back to the agent's identity name and any global `mentionPatterns` from your agent config.

## Configuration examples

```yaml
# Small group / 1:1 — respond to everything
channels:
  groupme:
    botId: "abc123"
    accessToken: "token123"
    botName: "oddclaw"
    requireMention: false

# Large group — mention only, with conversation context
channels:
  groupme:
    botId: "abc123"
    accessToken: "token123"
    botName: "oddclaw"
    requireMention: true
    historyLimit: 30
    mentionPatterns: ["@oddclaw", "oddclaw"]
    security:
      callbackAuth:
        token: "REPLACE_WITH_LONG_RANDOM_SECRET"
        tokenLocation: "query"
        queryKey: "k"
        rejectStatus: 404
      groupBinding:
        expectedGroupId: "123456789"
      replay:
        enabled: true
        ttlSeconds: 600
        maxEntries: 10000
      rateLimit:
        enabled: true
        windowMs: 60000
        maxRequestsPerIp: 120
        maxRequestsPerSender: 60
        maxConcurrent: 8
      media:
        allowPrivateNetworks: false
        maxDownloadBytes: 15728640
        requestTimeoutMs: 10000
        allowedMimePrefixes: ["image/"]
      logging:
        redactSecrets: true
        logRejectedRequests: true
      proxy:
        enabled: false
        trustedProxyCidrs: ["127.0.0.1/32", "::1/128"]
        allowedPublicHosts: ["bot.example.com"]
        requireHttpsProto: true
        rejectStatus: 403

# Large group — mention only, no history buffer
channels:
  groupme:
    botId: "abc123"
    accessToken: "token123"
    botName: "oddclaw"
    requireMention: true
    historyLimit: 0
```

## Security hardening (default)

The plugin now includes a staged webhook guard pipeline before inbound dispatch:

1. Method check (`POST` only)
2. Callback token auth (`security.callbackAuth.token`, when configured)
3. JSON/body size + timeout checks
4. Payload parsing + filtering of bot/system/empty messages
5. Group binding (`security.groupBinding.expectedGroupId`, when configured)
6. Replay protection (`security.replay`)
7. Rate limiting + concurrency caps (`security.rateLimit`)

`security.callbackAuth` is active when `security.callbackAuth.token` is non-empty.
`security.groupBinding` is active when `security.groupBinding.expectedGroupId` is non-empty.

Outbound media sends are also hardened:

- Shared `runtime.channel.media.fetchRemoteMedia(...)` fetch path with SSRF policy
- Private-network targets blocked by default
- MIME allowlist enforcement (`image/*` by default)
- Download byte cap and timeout enforcement

## Callback URL format

If `security.callbackAuth.token` is set and `tokenLocation: "query"` (default), your GroupMe callback URL must include the token query param:

`https://<your-public-domain><callbackPath>?<queryKey>=<token>`

Example:

`https://bot.example.com/groupme/9f5d7c2a?k=REPLACE_WITH_LONG_RANDOM_SECRET`

## Config reference

| Field             | Type     | Default    | Description                                                   |
| ----------------- | -------- | ---------- | ------------------------------------------------------------- |
| `botId`           | string   | —          | **Required.** GroupMe Bot ID                                  |
| `accessToken`     | string   | —          | GroupMe access token (needed for image uploads)               |
| `botName`         | string   | —          | Bot display name (used for mention detection)                 |
| `callbackPath`    | string   | `/groupme` | Webhook route path                                            |
| `requireMention`  | boolean  | `true`     | Only respond when mentioned                                   |
| `historyLimit`    | number   | `20`       | Max buffered messages per group (when `requireMention: true`) |
| `mentionPatterns` | string[] | —          | Custom regex patterns that count as a mention                 |
| `allowFrom`       | array    | —          | Sender ID allowlist (`"*"` to allow all)                      |
| `textChunkLimit`  | number   | `1000`     | Max outbound text chunk size                                  |
| `security`        | object   | —          | Security hardening controls (auth, binding, replay, rate, media, logging) |

### Security config reference

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `security.callbackAuth.token` | string | — | Active callback token. When set, callback token checks are enabled |
| `security.callbackAuth.tokenLocation` | enum | `"query"` | Where token is read (`query`, `path`, `either`) |
| `security.callbackAuth.queryKey` | string | `"k"` | Query parameter name when `tokenLocation` includes query |
| `security.callbackAuth.previousTokens` | string[] | `[]` | Optional rotation grace tokens |
| `security.callbackAuth.rejectStatus` | number | `404` | Reject status for auth failures (`200`, `401`, `403`, `404`) |
| `security.groupBinding.expectedGroupId` | string | — | Expected GroupMe `group_id`. When set, payload group binding is enforced |
| `security.replay.enabled` | boolean | `true` | Enable replay dedupe |
| `security.replay.ttlSeconds` | number | `600` | Replay dedupe TTL |
| `security.replay.maxEntries` | number | `10000` | Replay cache size bound |
| `security.rateLimit.enabled` | boolean | `true` | Enable webhook rate limiting |
| `security.rateLimit.windowMs` | number | `60000` | Sliding window size |
| `security.rateLimit.maxRequestsPerIp` | number | `120` | Max webhook requests per IP per window |
| `security.rateLimit.maxRequestsPerSender` | number | `60` | Max webhook requests per sender per window |
| `security.rateLimit.maxConcurrent` | number | `8` | Max concurrent inbound executions |
| `security.media.allowPrivateNetworks` | boolean | `false` | Allow private-network media fetch targets |
| `security.media.maxDownloadBytes` | number | `15728640` | Max outbound media download size |
| `security.media.requestTimeoutMs` | number | `10000` | Outbound media fetch timeout |
| `security.media.allowedMimePrefixes` | string[] | `["image/"]` | Allowed outbound media MIME prefixes |
| `security.logging.redactSecrets` | boolean | `true` | Redact callback secrets in logs/status |
| `security.logging.logRejectedRequests` | boolean | `true` | Emit webhook rejection logs |
| `security.commandBypass.requireAllowFrom` | boolean | `true` | Require `allowFrom` membership for control-command bypass |
| `security.commandBypass.requireMentionForCommands` | boolean | `false` | Require mention even for control commands |
| `security.proxy.enabled` | boolean | `false` | Enable trusted-proxy-aware host/proto/client-IP validation |
| `security.proxy.trustedProxyCidrs` | string[] | `[]` | Only trust `X-Forwarded-*` when source IP matches one of these CIDRs |
| `security.proxy.allowedPublicHosts` | string[] | `[]` | Allowed effective public hosts (from trusted forwarded host or Host header) |
| `security.proxy.requireHttpsProto` | boolean | `false` | Require effective protocol to be `https` |
| `security.proxy.rejectStatus` | number | `403` | Reject status for proxy-policy failures (`400`, `403`, `404`) |

## Environment variables (default account fallback)

For the default account only, these env vars are supported:

- `GROUPME_BOT_ID`
- `GROUPME_ACCESS_TOKEN`
- `GROUPME_BOT_NAME`
- `GROUPME_CALLBACK_PATH`

If both config and env are set, config values take precedence.

## Notes and limitations

- Group chats only (no DM channel mode)
- Inbound bot/system messages are ignored
- GroupMe message text limit is 1000 chars per chunk
- Media replies require `accessToken` so OpenClaw can upload images to GroupMe
- If `security.callbackAuth.token` is configured, GroupMe callback URL must include the configured token

## Troubleshooting

- **Bot does not respond:**
  - Confirm webhook URL is public + HTTPS and matches `callbackPath`
  - Confirm callback token query/path matches `security.callbackAuth` settings
  - Confirm `botId` is correct
  - If `requireMention: true`, mention the bot by name in the message
  - Check `allowFrom` (if set)
- **Webhook returns 404/401/403:**
  - Check callback token and `security.callbackAuth.rejectStatus`
  - Check `security.groupBinding.expectedGroupId` matches inbound group
- **Bot responds but has no context:**
  - Make sure `historyLimit` is not set to `0`
  - History is only buffered for `requireMention: true` mode
- **Image replies fail:**
  - Ensure `accessToken` is configured
- **Check runtime logs:**

```bash
openclaw channels logs --channel groupme
```
