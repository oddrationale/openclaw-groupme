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

```json5
{
  channels: {
    groupme: {
      enabled: true,
      botId: "YOUR_GROUPME_BOT_ID",
      accessToken: "YOUR_GROUPME_ACCESS_TOKEN",
      botName: "openclaw",
      callbackPath: "/groupme",
      requireMention: true
    }
  }
}
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

7. Send a test message in the GroupMe group:
   - With default settings, the bot only responds when mentioned (`requireMention: true`)
   - Mention either `@<botName>` or a configured mention pattern

## Config reference (common fields)

- `botId` (string, required): GroupMe Bot ID
- `accessToken` (string): needed for image upload / media replies
- `botName` (string): mention fallback name used by mention detection
- `callbackPath` (string, default `/groupme`): webhook route path
- `requireMention` (boolean, default `true`): require mention before responding
- `mentionPatterns` (string[]): custom regex patterns that count as a mention
- `allowFrom` (array of string/number): sender allowlist (`"*"` to allow all)
- `textChunkLimit` (number): max outbound text chunk size (capped at 1000)

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

- Bot does not respond:
  - Confirm webhook URL is public + HTTPS and matches `callbackPath`
  - Confirm `botId` is correct
  - If `requireMention: true`, mention the bot in the message
  - Check `allowFrom` (if set)
- Image replies fail:
  - Ensure `accessToken` is configured
- Check runtime logs:

```bash
openclaw channels logs --channel groupme
```
