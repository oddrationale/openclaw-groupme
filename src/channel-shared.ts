import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/core";
import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import type { CoreConfig, GroupMeConfig, ResolvedGroupMeAccount } from "./types.js";
import {
  listGroupMeAccountIds,
  resolveDefaultGroupMeAccountId,
  resolveGroupMeAccount,
} from "./accounts.js";
import { GroupMeConfigSchema } from "./config-schema.js";
import { normalizeGroupMeAllowEntry } from "./normalize.js";
import { groupmeSetupWizard } from "./onboarding.js";
import { redactCallbackUrl, resolveGroupMeSecurity } from "./security.js";

export const CHANNEL_ID = "groupme" as const;

const ENV_BOT_ID = "GROUPME_BOT_ID";

function hasGroupMeConfiguredState(env?: NodeJS.ProcessEnv): boolean {
  return typeof env?.[ENV_BOT_ID] === "string" && env[ENV_BOT_ID].trim().length > 0;
}

function redactWebhookPath(
  account: ResolvedGroupMeAccount,
  callbackUrl: string | undefined,
): string {
  const normalized = callbackUrl?.trim() || "/groupme";
  const security = resolveGroupMeSecurity(account.config);
  if (!security.logging.redactSecrets) {
    return normalized;
  }
  return redactCallbackUrl(normalized, security);
}

export const groupmeChannelMeta = {
  id: CHANNEL_ID,
  label: "GroupMe",
  selectionLabel: "GroupMe (Bot API)",
  detailLabel: "GroupMe Bot",
  docsPath: "/channels/groupme",
  docsLabel: "groupme",
  blurb: "GroupMe bot webhook integration (group chats only).",
  aliases: ["gm"],
  systemImage: "bubble.left.and.bubble.right",
  order: 95,
  quickstartAllowFrom: true,
} as const;

export const groupmeChannelPluginCommon = {
  meta: groupmeChannelMeta,
  setupWizard: groupmeSetupWizard,
  capabilities: {
    chatTypes: ["group"],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.groupme"] },
  configSchema: buildChannelConfigSchema(GroupMeConfigSchema),
  config: {
    listAccountIds: (cfg) => listGroupMeAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveGroupMeAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultGroupMeAccountId(cfg as CoreConfig),
    hasConfiguredState: ({ env }) => hasGroupMeConfiguredState(env),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: CHANNEL_ID,
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: CHANNEL_ID,
        accountId,
        clearBaseFields: [
          "name",
          "botId",
          "accessToken",
          "botName",
          "groupId",
          "publicDomain",
          "callbackUrl",
          "mentionPatterns",
          "requireMention",
          "historyLimit",
          "allowFrom",
          "textChunkLimit",
          "responsePrefix",
          "security",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      botId: account.botId ? "***" : "",
      publicDomain: account.config.publicDomain ?? "",
      callbackUrl: redactWebhookPath(account, account.config.callbackUrl),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveGroupMeAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => normalizeGroupMeAllowEntry(String(entry)))
        .filter((entry): entry is string => Boolean(entry)),
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId }) => {
      const account = resolveGroupMeAccount({
        cfg: cfg as CoreConfig,
        accountId,
      });
      return account.config.requireMention ?? true;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: CHANNEL_ID,
        accountId,
        name,
      }),
    validateInput: ({ input }) => {
      if (!input.token?.trim()) {
        return "GroupMe Bot ID is required (--token <bot-id>)";
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
      if (input.token?.trim()) updates.botId = input.token.trim();
      if (input.accessToken?.trim()) updates.accessToken = input.accessToken.trim();
      if (input.webhookUrl?.trim()) {
        updates.callbackUrl = input.webhookUrl.trim();
      } else if (input.webhookPath?.trim()) {
        updates.callbackUrl = input.webhookPath.trim();
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
  } satisfies ChannelSetupAdapter,
} satisfies Pick<
  ChannelPlugin<ResolvedGroupMeAccount>,
  "meta" | "setupWizard" | "capabilities" | "reload" | "configSchema" | "config" | "groups" | "setup"
>;
