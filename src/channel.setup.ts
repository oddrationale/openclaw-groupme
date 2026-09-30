import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk/core";
import {
  hasSecretInput,
  listGroupMeAccountIds,
  resolveDefaultGroupMeAccountId,
  resolveGroupMeAccount,
} from "./accounts.js";
import { GroupMeConfigSchema, groupmeConfigUiHints } from "./config-schema.js";
import { normalizeGroupMeAllowEntry } from "./normalize.js";
import { groupmeOnboardingAdapter } from "./onboarding.js";
import { channelSecrets } from "./secret-contract.js";
import { groupmeSetupContract } from "./setup-surface.js";
import type { CoreConfig, GroupMeProbe, ResolvedGroupMeAccount } from "./types.js";
import { normalizeWebhookPath } from "./webhook-path.js";

export const CHANNEL_ID = "groupme" as const;

const groupmeMeta = {
  id: CHANNEL_ID,
  label: "GroupMe",
  selectionLabel: "GroupMe (Bot API)",
  detailLabel: "GroupMe Bot",
  docsPath: "/channels/groupme",
  docsLabel: "groupme",
  blurb: "GroupMe bot webhook integration (group chats only).",
  aliases: ["gm"],
  order: 95,
  quickstartAllowFrom: true,
};

const configSchema = buildChannelConfigSchema(GroupMeConfigSchema, {
  uiHints: groupmeConfigUiHints,
});

/**
 * Setup-safe plugin surface: metadata, config resolution, secrets, and setup.
 * It must not import the webhook monitor, inbound pipeline, or outbound sender so
 * the setup entry stays cheap for disabled or unconfigured installs.
 */
export const groupmeSetupPlugin = {
  id: CHANNEL_ID,
  meta: groupmeMeta,
  setupContract: groupmeSetupContract,
  setupWizard: groupmeOnboardingAdapter,
  capabilities: {
    chatTypes: ["group" as const],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.groupme"] },
  configSchema,
  secrets: channelSecrets,
  config: {
    listAccountIds: (cfg) => listGroupMeAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveGroupMeAccount({ cfg: cfg as CoreConfig, accountId }),
    // Core's audit and diagnostics hand this result to adapters that expect the
    // resolved account (e.g. security.collectWarnings), so keep every account field
    // and add the status-safe credential summaries on top.
    inspectAccount: (cfg, accountId) => {
      const account = resolveGroupMeAccount({ cfg: cfg as CoreConfig, accountId });
      return {
        ...account,
        botIdStatus: hasSecretInput(account.config.botId) ? "available" : "missing",
        accessTokenStatus: hasSecretInput(account.config.accessToken) ? "available" : "missing",
        callbackTokenStatus: hasSecretInput(account.config.callbackToken) ? "available" : "missing",
      };
    },
    defaultAccountId: (cfg) => resolveDefaultGroupMeAccountId(cfg as CoreConfig),
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
          "callbackToken",
          "botName",
          "groupId",
          "publicDomain",
          "webhookPath",
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
      botId: hasSecretInput(account.config.botId) ? "***" : "",
      publicDomain: account.config.publicDomain ?? "",
      webhookPath: normalizeWebhookPath(account.config.webhookPath),
      callbackToken: hasSecretInput(account.config.callbackToken) ? "***" : "",
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveGroupMeAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => normalizeGroupMeAllowEntry(String(entry)))
        .filter((entry): entry is string => Boolean(entry)),
  },
} satisfies ChannelPlugin<ResolvedGroupMeAccount, GroupMeProbe>;
