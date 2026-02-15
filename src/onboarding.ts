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
    return {
      channel: "groupme",
      configured,
      statusLines: [
        `GroupMe (${accountId}): ${configured ? "configured" : "needs botId"}`,
        account.config.accessToken?.trim()
          ? "Access token configured"
          : "Access token missing (needed for image uploads)",
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
        initialValue: "/groupme",
        validate: (value) =>
          value.trim().startsWith("/") ? undefined : "Path must start with /",
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
      },
    });

    await prompter.note(
      [
        "Next steps:",
        `1. Set GroupMe callback URL to https://<your-domain>${callbackPath}`,
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
