import { randomBytes } from "node:crypto";
import type { ChannelOnboardingAdapter } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { CoreConfig, GroupMeConfig } from "./types.js";
import { resolveGroupMeAccount } from "./accounts.js";

function applyGroupMeConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  updates: Record<string, unknown>;
}): OpenClawConfig {
  const { cfg, accountId, updates } = params;
  const section = (cfg.channels?.groupme ?? {}) as GroupMeConfig;

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        groupme: {
          ...section,
          ...updates,
          enabled: true,
        },
      },
    };
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      groupme: {
        ...section,
        enabled: true,
        accounts: {
          ...(section.accounts ?? {}),
          [accountId]: {
            ...(section.accounts?.[accountId] ?? {}),
            ...updates,
            enabled: true,
          },
        },
      },
    },
  };
}

export const groupmeOnboardingAdapter: ChannelOnboardingAdapter = {
  channel: "groupme",
  getStatus: async ({ cfg, accountOverrides }) => {
    const accountId = accountOverrides.groupme ?? DEFAULT_ACCOUNT_ID;
    const account = resolveGroupMeAccount({
      cfg: cfg as CoreConfig,
      accountId,
    });

    const configured = account.configured;
    const callbackTokenConfigured = Boolean(
      account.config.security?.callbackAuth?.token?.trim(),
    );
    const expectedGroupIdConfigured = Boolean(
      account.config.security?.groupBinding?.expectedGroupId?.trim(),
    );
    return {
      channel: "groupme",
      configured,
      statusLines: [
        `GroupMe (${accountId}): ${configured ? "configured" : "needs botId"}`,
        account.config.accessToken?.trim()
          ? "Access token configured"
          : "Access token missing (needed for image uploads)",
        callbackTokenConfigured
          ? "Webhook callback token configured"
          : "Webhook callback token missing",
        expectedGroupIdConfigured
          ? "Group binding configured"
          : "Group binding expectedGroupId missing",
      ],
      selectionHint: configured ? "configured" : "needs bot ID",
      quickstartScore: configured ? 1 : 0,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides }) => {
    const accountId = accountOverrides.groupme ?? DEFAULT_ACCOUNT_ID;

    await prompter.note(
      [
        "GroupMe bots are bound to a single group.",
        "Create a bot at https://dev.groupme.com/bots and copy bot_id + access token.",
      ].join("\n"),
      "GroupMe setup",
    );

    const botId = (
      await prompter.text({
        message: "Bot ID",
        validate: (value) => (value.trim() ? undefined : "Bot ID is required"),
      })
    ).trim();

    const accessToken = (
      await prompter.text({
        message: "Access token",
        validate: (value) =>
          value.trim() ? undefined : "Access token is required",
      })
    ).trim();

    const botName = (
      await prompter.text({
        message: "Bot name (mention fallback)",
        initialValue: "openclaw",
      })
    ).trim();

    const callbackPath = (
      await prompter.text({
        message: "Webhook path",
        initialValue: `/groupme/${randomBytes(8).toString("hex")}`,
        validate: (value) =>
          value.trim().startsWith("/") ? undefined : "Path must start with /",
      })
    ).trim();
    const callbackToken = (
      await prompter.text({
        message: "Webhook callback token",
        initialValue: randomBytes(32).toString("hex"),
        validate: (value) =>
          value.trim().length >= 16
            ? undefined
            : "Use a high-entropy token (at least 16 characters)",
      })
    ).trim();
    const expectedGroupId = (
      await prompter.text({
        message: "Expected Group ID",
        validate: (value) =>
          value.trim() ? undefined : "Expected Group ID is required",
      })
    ).trim();

    const requireMention = await prompter.confirm({
      message: "Require mention to respond?",
      initialValue: true,
    });

    const next = applyGroupMeConfig({
      cfg,
      accountId,
      updates: {
        botId,
        accessToken,
        botName,
        callbackPath,
        requireMention,
        security: {
          callbackAuth: {
            token: callbackToken,
            tokenLocation: "query",
            queryKey: "k",
            rejectStatus: 404,
          },
          groupBinding: {
            expectedGroupId,
          },
          replay: {
            enabled: true,
            ttlSeconds: 600,
            maxEntries: 10_000,
          },
          rateLimit: {
            enabled: true,
            windowMs: 60_000,
            maxRequestsPerIp: 120,
            maxRequestsPerSender: 60,
            maxConcurrent: 8,
          },
          media: {
            allowPrivateNetworks: false,
            maxDownloadBytes: 15 * 1024 * 1024,
            requestTimeoutMs: 10_000,
            allowedMimePrefixes: ["image/"],
          },
          logging: {
            redactSecrets: true,
            logRejectedRequests: true,
          },
          commandBypass: {
            requireAllowFrom: true,
            requireMentionForCommands: false,
          },
          proxy: {
            enabled: false,
            trustedProxyCidrs: ["127.0.0.1/32", "::1/128"],
            allowedPublicHosts: [],
            requireHttpsProto: false,
            rejectStatus: 403,
          },
        },
      },
    });

    await prompter.note(
      [
        "Next steps:",
        `1. Set GroupMe callback URL to https://<your-domain>${callbackPath}?k=${callbackToken}`,
        "2. Restart gateway",
        "3. Send a message in the group to test",
      ].join("\n"),
      "GroupMe next steps",
    );

    return {
      cfg: next,
      accountId,
    };
  },
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      groupme: {
        ...(cfg.channels?.groupme ?? {}),
        enabled: false,
      },
    },
  }),
};
