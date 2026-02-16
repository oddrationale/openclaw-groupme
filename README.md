# openclaw-groupme

GroupMe channel plugin for OpenClaw (GroupMe Bot API, group chats only).

## Install

```bash
openclaw plugins install openclaw-groupme
```

Restart the gateway after installing the plugin.

## What this plugin needs

1. Your GroupMe access token (for interactive onboarding)
2. A public HTTPS URL that can reach your OpenClaw gateway
3. A GroupMe group where the bot should run

## Step-by-step setup (interactive, recommended)

1. Install plugin:

```bash
openclaw plugins install openclaw-groupme
```

2. Run the interactive setup:

```bash
openclaw channels add --channel groupme
```

3. Enter your GroupMe access token when prompted.

The wizard will:
- Fetch your groups from GroupMe
- Let you select a group
- Register a bot automatically
- Generate a secure callback URL
- Write config fields (`botId`, `groupId`, `publicDomain`, `callbackUrl`, security defaults)

4. Restart OpenClaw gateway:

```bash
openclaw gateway restart
```

5. Verify channel status:

```bash
openclaw channels status --probe
```

6. Send a test message in the GroupMe group.

## CLI setup (non-interactive)

Use this path if you already have `bot_id` and want scriptable setup.

```bash
openclaw channels add --channel groupme \
  --token "YOUR_GROUPME_BOT_ID" \
  --access-token "YOUR_GROUPME_ACCESS_TOKEN" \
  --webhook-url "/groupme/callback?k=YOUR_SECRET"
```

For named accounts:

```bash
openclaw channels add --channel groupme \
  --account work \
  --name "Work Bot" \
  --token "YOUR_GROUPME_BOT_ID" \
  --access-token "YOUR_GROUPME_ACCESS_TOKEN" \
  --webhook-url "/groupme/callback?k=YOUR_SECRET"
```

Notes:
- `--token` maps to `botId`
- `--access-token` maps to `accessToken`
- `--webhook-url` (or fallback `--webhook-path`) maps to `callbackUrl`
- CLI setup does not prompt for `botName`, `groupId`, or `requireMention`

## Manual config example

```yaml
channels:
  groupme:
    enabled: true
    botName: "oddclaw"
    accessToken: "YOUR_GROUPME_ACCESS_TOKEN"
    botId: "YOUR_GROUPME_BOT_ID"
    groupId: "YOUR_GROUPME_GROUP_ID"
    publicDomain: "bot.example.com"
    callbackUrl: "/groupme/e60b3e59da98950f?k=YOUR_SECRET"
    requireMention: true
    historyLimit: 20
    security:
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
      commandBypass:
        requireAllowFrom: true
        requireMentionForCommands: false
      proxy:
        enabled: false
        trustedProxyCidrs: ["127.0.0.1/32", "::1/128"]
        allowedPublicHosts: []
        requireHttpsProto: false
        rejectStatus: 403
```

## Response modes

The bot has two modes controlled by `requireMention`.

### Always respond (`requireMention: false`)

The bot replies to every message in the group.

```yaml
channels:
  groupme:
    requireMention: false
```

### Mention only (`requireMention: true`, default)

The bot only replies when mentioned by name. It still passively buffers recent messages for context.

```yaml
channels:
  groupme:
    requireMention: true
    historyLimit: 30
```

Set `historyLimit: 0` to disable history buffering.

## How mentioning works

GroupMe bots do not have native @mention entities, so this plugin uses text matching.

```yaml
channels:
  groupme:
    botName: "oddclaw"
    mentionPatterns:
      - "@oddclaw"
      - "oddclaw"
      - "hey oddclaw"
```

Patterns are case-insensitive regexes.

## Security hardening (default)

Inbound webhook pipeline:

1. Method check (`POST` only)
2. Callback token auth (`callbackUrl` query param `k`)
3. JSON body size + timeout checks
4. Payload parsing + filtering of bot/system/empty messages
5. Group binding (`groupId`, when configured)
6. Replay protection (`security.replay`)
7. Rate limiting + concurrency caps (`security.rateLimit`)

Outbound media sends are hardened with SSRF guard, private-network blocking by default, MIME allowlist, timeout, and max byte caps.

## Callback URL format

`callbackUrl` stores the full relative webhook URL (path + query token), for example:

`/groupme/e60b3e59da98950f?k=775c9958da544c73e6d97c04f884957caa174c8570889bbaa0900d6253f20bbc`

Set the bot callback in GroupMe to:

`https://<your-public-domain><callbackUrl>`

## Config reference

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `botId` | string | — | GroupMe Bot ID |
| `accessToken` | string | — | GroupMe access token (required for image uploads and onboarding API calls) |
| `botName` | string | — | Bot display name used for mention detection |
| `groupId` | string | — | Expected GroupMe `group_id` for inbound binding |
| `publicDomain` | string | — | Public domain where the OpenClaw gateway is reachable (e.g. `bot.example.com`) |
| `callbackUrl` | string | `/groupme` | Relative webhook URL including query token |
| `requireMention` | boolean | `true` | Only respond when mentioned |
| `historyLimit` | number | `20` | Max buffered messages per group when `requireMention: true` |
| `mentionPatterns` | string[] | — | Custom regex mention patterns |
| `allowFrom` | array | — | Sender allowlist (`"*"` allows all) |
| `textChunkLimit` | number | `1000` | Max outbound text chunk size |
| `security` | object | — | Security controls (replay, rate, media, logging, commandBypass, proxy) |

### Security config reference

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
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
| `security.commandBypass.requireAllowFrom` | boolean | `true` | Require `allowFrom` membership for command bypass |
| `security.commandBypass.requireMentionForCommands` | boolean | `false` | Require mention even for control commands |
| `security.proxy.enabled` | boolean | `false` | Enable trusted-proxy host/proto/client-IP validation |
| `security.proxy.trustedProxyCidrs` | string[] | `[]` | Trust forwarded headers only from these CIDRs |
| `security.proxy.allowedPublicHosts` | string[] | `[]` | Allowed effective public hosts |
| `security.proxy.requireHttpsProto` | boolean | `false` | Require effective protocol to be `https` |
| `security.proxy.rejectStatus` | number | `403` | Reject status for proxy-policy failures (`400`, `403`, `404`) |

## Environment variables (default account fallback)

For the default account only:

- `GROUPME_BOT_ID`
- `GROUPME_ACCESS_TOKEN`
- `GROUPME_BOT_NAME`
- `GROUPME_GROUP_ID`
- `GROUPME_PUBLIC_DOMAIN`
- `GROUPME_CALLBACK_URL`

If both config and env are set, config values take precedence.

## Notes and limitations

- Group chats only (no DM channel mode)
- Inbound bot/system messages are ignored
- GroupMe message text limit is 1000 chars per chunk
- Media replies require `accessToken` so OpenClaw can upload images to GroupMe
- Onboarding registers the bot with the real callback URL using `publicDomain`
- If you change your domain later, update `publicDomain` in config and update the bot callback URL at `https://dev.groupme.com/bots`

## Troubleshooting

- **Bot does not respond:**
  - Confirm webhook URL is public + HTTPS and matches `callbackUrl`
  - Confirm `groupId` matches the GroupMe `group_id`
  - Confirm `botId` is correct
  - If `requireMention: true`, mention the bot by name
  - Check `allowFrom` (if set)
- **Webhook returns 404/403:**
  - Check that inbound requests include the correct `k` token from `callbackUrl`
  - Check `groupId` binding and proxy policy settings
- **Bot responds but has no context:**
  - Ensure `historyLimit` is not `0`
  - History buffering is only used when `requireMention: true`
- **Image replies fail:**
  - Ensure `accessToken` is configured
- **Bot registration fails with "callback URL validation has failed":**
  - GroupMe validates the callback domain at bot creation time (HEAD/ICMP ping)
  - Your public domain must be live and reachable when running setup
  - Verify the domain resolves and responds: `curl -I https://your-domain.com`
- **Check runtime logs:**

```bash
openclaw channels logs --channel groupme
```
