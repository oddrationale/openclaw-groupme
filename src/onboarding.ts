import { randomBytes } from "node:crypto";
import type { ChannelOnboardingAdapter } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { resolveGroupMeAccount } from "./accounts.js";
import { createBot, fetchGroups } from "./groupme-api.js";
import type { CoreConfig, GroupMeConfig } from "./types.js";

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

function redactMiddle(value: string): string {
  if (value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-3)}`;
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
    const callbackUrlConfigured = Boolean(account.config.callbackUrl?.trim());
    const groupIdConfigured = Boolean(account.config.groupId?.trim());
    const publicDomainConfigured = Boolean(account.config.publicDomain?.trim());

    return {
      channel: "groupme",
      configured,
      statusLines: [
        `GroupMe (${accountId}): ${configured ? "configured" : "needs access token"}`,
        account.config.accessToken?.trim()
          ? "Access token configured"
          : "Access token missing",
        callbackUrlConfigured
          ? "Webhook callback URL configured"
          : "Webhook callback URL missing",
        publicDomainConfigured
          ? "Public domain configured"
          : "Public domain missing",
        groupIdConfigured ? "Group ID configured" : "Group ID missing",
      ],
      selectionHint: configured ? "configured" : "needs access token",
      quickstartScore: configured ? 1 : 0,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides }) => {
    const accountId = accountOverrides.groupme ?? DEFAULT_ACCOUNT_ID;

    const botNameInput = (
      await prompter.text({
        message: "Bot name",
        initialValue: "openclaw",
      })
    ).trim();
    const botName = botNameInput || "openclaw";

    const accessToken = (
      await prompter.text({
        message: "GroupMe access token",
        validate: (value) =>
          value.trim() ? undefined : "Access token is required",
      })
    ).trim();

    const groupsSpin = prompter.progress("Fetching your GroupMe groups...");
    let groups: Awaited<ReturnType<typeof fetchGroups>>;
    try {
      groups = await fetchGroups(accessToken);
    } catch {
      groupsSpin.stop("Failed");
      await prompter.note(
        "Could not fetch groups. Check your access token and try again.",
        "GroupMe setup failed",
      );
      throw new Error("Could not fetch groups");
    }

    if (groups.length === 0) {
      groupsSpin.stop("No groups found");
      await prompter.note(
        "No groups found. Create or join a GroupMe group first.",
        "GroupMe setup failed",
      );
      throw new Error("No GroupMe groups found");
    }
    groupsSpin.stop(`Found ${groups.length} groups`);

    const groupId = await prompter.select<string>({
      message: "Select a GroupMe group",
      options: groups.map((group) => ({
        value: group.id,
        label: group.name || group.id,
        hint: group.id,
      })),
    });
    const selectedGroup = groups.find((group) => group.id === groupId);
    const requireMention = await prompter.confirm({
      message: "Require mention to respond?",
      initialValue: true,
    });
    const publicDomainRaw = (
      await prompter.text({
        message: "Public domain (must be reachable — GroupMe will ping it)",
        validate: (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            return "Public domain is required";
          }
          const normalized = trimmed
            .replace(/^https?:\/\//, "")
            .replace(/\/+$/, "");
          if (!normalized) {
            return "Public domain is required";
          }
          return undefined;
        },
      })
    ).trim();
    let publicDomain: string;
    const trimmedPublicDomain = publicDomainRaw.trim();
    try {
      if (/^https?:\/\//i.test(trimmedPublicDomain)) {
        const url = new URL(trimmedPublicDomain);
        publicDomain = url.port ? `${url.hostname}:${url.port}` : url.hostname;
      } else {
        const withoutLeadingSlashes = trimmedPublicDomain.replace(/^\/+/, "");
        publicDomain = withoutLeadingSlashes.split(/[\/?#]/, 1)[0];
      }
    } catch {
      // Fallback: best-effort stripping of scheme and any path/query/fragment
      const noScheme = trimmedPublicDomain.replace(/^https?:\/\//i, "");
      publicDomain = noScheme.split(/[\/?#]/, 1)[0];
    }

    const pathSegment = randomBytes(8).toString("hex");
    const callbackToken = randomBytes(32).toString("hex");
    const callbackUrl = `/groupme/${pathSegment}?k=${callbackToken}`;
    await prompter.note(
      `Generated webhook callback URL: /groupme/${pathSegment}?k=***`,
      "Generated callback URL",
    );

    const botSpin = prompter.progress("Registering bot with GroupMe...");
    let botId = "";
    try {
      const bot = await createBot({
        accessToken,
        name: botName,
        groupId,
        callbackUrl: `https://${publicDomain}${callbackUrl}`,
      });
      botId = bot.bot_id;
      botSpin.stop("Bot registered");
    } catch (error) {
      botSpin.stop("Failed");
      const detail = error instanceof Error ? `\n\nDetails: ${error.message}` : "";
      await prompter.note(
        `Failed to register bot with GroupMe. Check your access token and try again.${detail}`,
        "GroupMe setup failed",
      );
      throw new Error("Failed to register GroupMe bot", {
        cause: error instanceof Error ? error : undefined,
      });
    }

    await prompter.note(
      `Bot "${botName}" registered in group "${selectedGroup?.name ?? groupId}" (bot ID: ${redactMiddle(botId)})`,
      "GroupMe bot registered",
    );

    const next = applyGroupMeConfig({
      cfg,
      accountId,
      updates: {
        botName,
        accessToken,
        botId,
        groupId,
        publicDomain,
        callbackUrl,
        requireMention,
      },
    });

    await prompter.note(
      [
        "Next steps:",
        "1. Restart the gateway: openclaw gateway restart",
        "2. Send a message in the group to test",
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
