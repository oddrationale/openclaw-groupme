import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { defineChannelSetupContract } from "openclaw/plugin-sdk/channel-setup";
import {
  applyAccountNameToChannelSection,
  migrateBaseNameToDefaultAccount,
} from "openclaw/plugin-sdk/core";
import { listGroupMeAccountIds, resolveDefaultGroupMeAccountId } from "./accounts.js";
import type { CoreConfig, GroupMeConfig } from "./types.js";
import { parseWebhookSetupInput } from "./webhook-path.js";

const CHANNEL_ID = "groupme" as const;

/**
 * Channel-owned setup fields for `openclaw channels add --channel groupme`.
 * Keep `package.json#openclaw.channel.setup.fields` in sync (a unit test checks).
 */
export const groupmeSetupFields = {
  botId: {
    kind: "string",
    sensitive: true,
    cli: { flags: "--bot-id <id>", description: "GroupMe bot ID" },
  },
  token: {
    kind: "string",
    sensitive: true,
    cli: { flags: "--token <bot-id>", description: "GroupMe bot ID (alias for --bot-id)" },
  },
  accessToken: {
    kind: "string",
    sensitive: true,
    cli: {
      flags: "--access-token <token>",
      description: "GroupMe access token (required for image replies)",
    },
  },
  callbackToken: {
    kind: "string",
    sensitive: true,
    cli: {
      flags: "--callback-token <token>",
      description: "Shared secret GroupMe sends as ?k= on the callback URL",
    },
  },
  groupId: {
    kind: "string",
    cli: { flags: "--group-id <id>", description: "GroupMe group ID the bot belongs to" },
  },
  botName: {
    kind: "string",
    cli: { flags: "--bot-name <name>", description: "Bot display name used for mentions" },
  },
  webhookPath: {
    kind: "string",
    cli: { flags: "--webhook-path <path>", description: "Gateway path for GroupMe callbacks" },
  },
  webhookUrl: {
    kind: "string",
    sensitive: true,
    cli: {
      flags: "--webhook-url <url>",
      description: "Full callback URL; sets the webhook path and ?k= callback token",
    },
  },
} as const;

export const groupmeSetupContract = defineChannelSetupContract({
  fields: groupmeSetupFields,
  adapter: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),

    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: CHANNEL_ID,
        accountId,
        name,
      }),

    validateInput: ({ input }) => {
      if (!input.botId?.trim() && !input.token?.trim()) {
        return "GroupMe bot ID is required (--bot-id <id>)";
      }
      return null;
    },

    applyAccountConfig: ({ cfg, accountId, input }) => {
      let next = applyAccountNameToChannelSection({
        cfg,
        channelKey: CHANNEL_ID,
        accountId,
        name: input.name,
      });

      if (accountId !== DEFAULT_ACCOUNT_ID) {
        next = migrateBaseNameToDefaultAccount({
          cfg: next,
          channelKey: CHANNEL_ID,
        });
      }

      const updates: Record<string, unknown> = { enabled: true };
      const botId = input.botId?.trim() || input.token?.trim();
      if (botId) updates.botId = botId;
      if (input.accessToken?.trim()) updates.accessToken = input.accessToken.trim();
      if (input.callbackToken?.trim()) updates.callbackToken = input.callbackToken.trim();
      if (input.groupId?.trim()) updates.groupId = input.groupId.trim();
      if (input.botName?.trim()) updates.botName = input.botName.trim();
      const webhookInput = input.webhookUrl?.trim() || input.webhookPath?.trim();
      if (webhookInput) {
        const parsed = parseWebhookSetupInput(webhookInput);
        updates.webhookPath = parsed.webhookPath;
        if (parsed.callbackToken && !updates.callbackToken) {
          updates.callbackToken = parsed.callbackToken;
        }
      }

      const section = (next.channels?.groupme ?? {}) as GroupMeConfig;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            groupme: {
              ...section,
              ...updates,
            },
          },
        };
      }

      return {
        ...next,
        channels: {
          ...next.channels,
          groupme: {
            ...section,
            enabled: true,
            accounts: {
              ...(section.accounts ?? {}),
              [accountId]: {
                ...(section.accounts?.[accountId] ?? {}),
                ...updates,
              },
            },
          },
        },
      };
    },

    resolveBindingAccountId: ({ cfg, accountId }) => {
      if (accountId) return accountId;
      const ids = listGroupMeAccountIds(cfg as CoreConfig);
      if (ids.length <= 1) return DEFAULT_ACCOUNT_ID;
      const section = (cfg as CoreConfig).channels?.groupme;
      const explicitDefault = section?.defaultAccount?.trim();
      return explicitDefault ? resolveDefaultGroupMeAccountId(cfg as CoreConfig) : undefined;
    },
  },
});
