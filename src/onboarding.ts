import { randomBytes } from "node:crypto";
import type {
  ChannelOnboardingAdapter,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
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

function parsePublicDomain(raw: string): string {
  const trimmed = raw.trim();
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      return url.port ? `${url.hostname}:${url.port}` : url.hostname;
    }
    const withoutLeadingSlashes = trimmed.replace(/^\/+/, "");
    return withoutLeadingSlashes.split(/[\/?#]/, 1)[0];
  } catch {
    const noScheme = trimmed.replace(/^https?:\/\//i, "");
    return noScheme.split(/[\/?#]/, 1)[0];
  }
}

function generateCallbackUrl(): string {
  const pathSegment = randomBytes(8).toString("hex");
  const callbackToken = randomBytes(32).toString("hex");
  return `/groupme/${pathSegment}?k=${callbackToken}`;
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
          const parsed = parsePublicDomain(trimmed);
          if (!parsed) {
            return "Public domain is required";
          }
          return undefined;
        },
      })
    ).trim();
    const publicDomain = parsePublicDomain(publicDomainRaw);

    const callbackUrl = generateCallbackUrl();
    const pathSegment = callbackUrl.split("?")[0].split("/").pop()!;
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
  configureWhenConfigured: async ({
    cfg,
    prompter,
    runtime,
    accountOverrides,
  }) => {
    const accountId = accountOverrides.groupme ?? DEFAULT_ACCOUNT_ID;
    const account = resolveGroupMeAccount({
      cfg: cfg as CoreConfig,
      accountId,
    });

    const action = await prompter.select<string>({
      message: "GroupMe is already configured. What would you like to do?",
      options: [
        { value: "skip", label: "Skip", hint: "no changes" },
        { value: "rotate_token", label: "Rotate access token" },
        { value: "change_group", label: "Change group" },
        { value: "regen_callback", label: "Regenerate callback URL" },
        { value: "toggle_mention", label: "Toggle requireMention" },
        { value: "update_domain", label: "Update public domain" },
        { value: "full_setup", label: "Full re-setup", hint: "start from scratch" },
      ],
    });

    if (action === "skip") {
      return "skip";
    }

    if (action === "full_setup") {
      return groupmeOnboardingAdapter.configure({
        cfg,
        prompter,
        runtime,
        accountOverrides,
        options: {},
        shouldPromptAccountIds: false,
        forceAllowFrom: false,
      });
    }

    if (action === "rotate_token") {
      const newToken = (
        await prompter.text({
          message: "New GroupMe access token",
          validate: (value) =>
            value.trim() ? undefined : "Access token is required",
        })
      ).trim();

      const spin = prompter.progress("Validating access token...");
      try {
        await fetchGroups(newToken);
        spin.stop("Token validated");
      } catch {
        spin.stop("Failed");
        await prompter.note(
          "Could not validate token. Check your access token and try again.",
          "Validation failed",
        );
        throw new Error("Could not validate access token");
      }

      const next = applyGroupMeConfig({
        cfg,
        accountId,
        updates: { accessToken: newToken },
      });
      await prompter.note("Access token updated.", "Token rotated");
      return { cfg: next, accountId };
    }

    if (action === "change_group") {
      const existingToken = account.accessToken;
      if (!existingToken) {
        await prompter.note(
          "No access token configured. Use \"Rotate access token\" first.",
          "Missing token",
        );
        return "skip";
      }

      const spin = prompter.progress("Fetching your GroupMe groups...");
      let groups: Awaited<ReturnType<typeof fetchGroups>>;
      try {
        groups = await fetchGroups(existingToken);
      } catch {
        spin.stop("Failed");
        await prompter.note(
          "Could not fetch groups. Check your access token and try again.",
          "GroupMe error",
        );
        throw new Error("Could not fetch groups");
      }

      if (groups.length === 0) {
        spin.stop("No groups found");
        await prompter.note(
          "No groups found. Create or join a GroupMe group first.",
          "No groups",
        );
        return "skip";
      }
      spin.stop(`Found ${groups.length} groups`);

      const newGroupId = await prompter.select<string>({
        message: "Select a GroupMe group",
        options: groups.map((group) => ({
          value: group.id,
          label: group.name || group.id,
          hint: group.id === account.config.groupId ? "current" : group.id,
        })),
      });

      const selectedGroup = groups.find((g) => g.id === newGroupId);
      const updates: Record<string, unknown> = { groupId: newGroupId };

      const registerNew = await prompter.confirm({
        message: "Register a new bot in this group?",
        initialValue: true,
      });

      if (!registerNew) {
        const newBotId = (
          await prompter.text({
            message:
              "Bot ID for the new group (existing bot won't work in a different group)",
            validate: (value) =>
              value.trim() ? undefined : "Bot ID is required",
          })
        ).trim();
        updates.botId = newBotId;
      }

      if (registerNew) {
        const botName = account.config.botName || "openclaw";
        let publicDomain = account.config.publicDomain;
        if (!publicDomain) {
          const domainRaw = (
            await prompter.text({
              message: "Public domain (required for bot registration)",
              validate: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return "Public domain is required";
                const normalized = trimmed
                  .replace(/^https?:\/\//, "")
                  .replace(/\/+$/, "");
                if (!normalized) return "Public domain is required";
                const parsed = parsePublicDomain(trimmed);
                if (!parsed) return "Public domain is required";
                return undefined;
              },
            })
          ).trim();
          publicDomain = parsePublicDomain(domainRaw);
          updates.publicDomain = publicDomain;
        }
        let rawCallbackUrl = account.config.callbackUrl;
        if (!rawCallbackUrl) {
          rawCallbackUrl = generateCallbackUrl();
          updates.callbackUrl = rawCallbackUrl;
        }
        const parsedCallback = new URL(rawCallbackUrl, "http://localhost");
        const callbackPath = `${parsedCallback.pathname}${parsedCallback.search}`;

        const botSpin = prompter.progress("Registering bot with GroupMe...");
        try {
          const bot = await createBot({
            accessToken: existingToken,
            name: botName,
            groupId: newGroupId,
            callbackUrl: `https://${publicDomain}${callbackPath}`,
          });
          updates.botId = bot.bot_id;
          botSpin.stop("Bot registered");
        } catch (error) {
          botSpin.stop("Failed");
          const detail =
            error instanceof Error ? `\n\nDetails: ${error.message}` : "";
          await prompter.note(
            `Failed to register bot.${detail}`,
            "Bot registration failed",
          );
          throw new Error("Failed to register GroupMe bot", {
            cause: error instanceof Error ? error : undefined,
          });
        }
      }

      const next = applyGroupMeConfig({ cfg, accountId, updates });
      await prompter.note(
        `Group changed to "${selectedGroup?.name ?? newGroupId}".`,
        "Group updated",
      );
      return { cfg: next, accountId };
    }

    if (action === "regen_callback") {
      const callbackUrl = generateCallbackUrl();
      const next = applyGroupMeConfig({
        cfg,
        accountId,
        updates: { callbackUrl },
      });
      await prompter.note(
        [
          "Callback URL regenerated.",
          "Remember to update your GroupMe bot settings or re-register the bot.",
        ].join("\n"),
        "Callback URL updated",
      );
      return { cfg: next, accountId };
    }

    if (action === "toggle_mention") {
      const current = account.config.requireMention ?? true;
      const next = applyGroupMeConfig({
        cfg,
        accountId,
        updates: { requireMention: !current },
      });
      await prompter.note(
        `requireMention changed from ${current} to ${!current}.`,
        "Mention setting updated",
      );
      return { cfg: next, accountId };
    }

    if (action === "update_domain") {
      const newDomainRaw = (
        await prompter.text({
          message: "New public domain",
          initialValue: account.config.publicDomain ?? "",
          validate: (value) => {
            const trimmed = value.trim();
            if (!trimmed) return "Public domain is required";
            const normalized = trimmed
              .replace(/^https?:\/\//, "")
              .replace(/\/+$/, "");
            if (!normalized) return "Public domain is required";
            const parsed = parsePublicDomain(trimmed);
            if (!parsed) return "Public domain is required";
            return undefined;
          },
        })
      ).trim();

      const publicDomain = parsePublicDomain(newDomainRaw);
      const next = applyGroupMeConfig({
        cfg,
        accountId,
        updates: { publicDomain },
      });
      await prompter.note(
        `Public domain updated to "${publicDomain}".`,
        "Domain updated",
      );
      return { cfg: next, accountId };
    }

    return "skip";
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
