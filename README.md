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
    callbackPath: "/groupme"
    requireMention: true
    historyLimit: 20
```

4. Point GroupMe to your webhook:
   - Callback URL format: `https://<your-public-domain><callbackPath>`
   - Example: `https://bot.example.com/groupme`
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

# Large group — mention only, no history buffer
channels:
  groupme:
    botId: "abc123"
    accessToken: "token123"
    botName: "oddclaw"
    requireMention: true
    historyLimit: 0
```

## Config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `botId` | string | — | **Required.** GroupMe Bot ID |
| `accessToken` | string | — | GroupMe access token (needed for image uploads) |
| `botName` | string | — | Bot display name (used for mention detection) |
| `callbackPath` | string | `/groupme` | Webhook route path |
| `requireMention` | boolean | `true` | Only respond when mentioned |
| `historyLimit` | number | `20` | Max buffered messages per group (when `requireMention: true`) |
| `mentionPatterns` | string[] | — | Custom regex patterns that count as a mention |
| `allowFrom` | array | — | Sender ID allowlist (`"*"` to allow all) |
| `textChunkLimit` | number | `1000` | Max outbound text chunk size |

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

## Troubleshooting

- **Bot does not respond:**
  - Confirm webhook URL is public + HTTPS and matches `callbackPath`
  - Confirm `botId` is correct
  - If `requireMention: true`, mention the bot by name in the message
  - Check `allowFrom` (if set)
- **Bot responds but has no context:**
  - Make sure `historyLimit` is not set to `0`
  - History is only buffered for `requireMention: true` mode
- **Image replies fail:**
  - Ensure `accessToken` is configured
- **Check runtime logs:**

```bash
openclaw channels logs --channel groupme
```
