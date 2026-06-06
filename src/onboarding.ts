import { randomBytes } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import type { ChannelSetupWizardAdapter } from "openclaw/plugin-sdk/setup";
import { hasSecretInput, resolveGroupMeAccount } from "./accounts.js";
import { createBot, fetchGroups } from "./groupme-api.js";
import type { CoreConfig, GroupMeConfig } from "./types.js";

type GroupMeOnboardingApi = {
  fetchGroups?: typeof fetchGroups;
  createBot?: typeof createBot;
};

function readSecretInputString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

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
  let candidate = "";
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      candidate = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    } else {
      const withoutLeadingSlashes = trimmed.replace(/^\/+/, "");
      candidate = withoutLeadingSlashes.split(/[/?#]/, 1)[0] ?? "";
    }
  } catch {
    const noScheme = trimmed.replace(/^https?:\/\//i, "");
    candidate = noScheme.split(/[/?#]/, 1)[0] ?? "";
  }

  if (!candidate || /[\s/?#@]/.test(candidate)) {
    return "";
  }

  try {
    const url = new URL(`https://${candidate}`);
    return url.hostname ? candidate : "";
  } catch {
    return "";
  }
}

function validatePublicDomainInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Public domain is required";
  }
  if (!parsePublicDomain(trimmed)) {
    return "Public domain must be a valid host";
  }
  return undefined;
}

function requirePublicDomain(raw: string): string {
  const publicDomain = parsePublicDomain(raw);
  if (!publicDomain) {
    throw new Error("Invalid public domain");
  }
  return publicDomain;
}

function generateCallbackSettings(): {
  webhookPath: string;
  callbackToken: string;
} {
  const pathSegment = randomBytes(8).toString("hex");
  return {
    webhookPath: `/groupme/${pathSegment}`,
    callbackToken: randomBytes(32).toString("hex"),
  };
}

function buildPublicCallbackUrl(params: {
  publicDomain: string;
  webhookPath: string;
  callbackToken: string;
}): string {
  const path = params.webhookPath.startsWith("/") ? params.webhookPath : `/${params.webhookPath}`;
  const url = new URL(`https://${params.publicDomain}${path}`);
  url.searchParams.set("k", params.callbackToken);
  return url.toString();
}

function redactMiddle(value: string): string {
  if (value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-3)}`;
}

export function createGroupMeOnboardingAdapter(
  api: GroupMeOnboardingApi = {},
): ChannelSetupWizardAdapter {
  const fetchGroupsImpl = api.fetchGroups ?? fetchGroups;
  const createBotImpl = api.createBot ?? createBot;

  const adapter: ChannelSetupWizardAdapter = {
    channel: "groupme",
    getStatus: async ({ cfg, accountOverrides }) => {
      const accountId = accountOverrides.groupme ?? DEFAULT_ACCOUNT_ID;
      const account = resolveGroupMeAccount({
        cfg: cfg as CoreConfig,
        accountId,
      });

      const configured = account.configured;
      const webhookPathConfigured = Boolean(account.config.webhookPath?.trim());
      const callbackTokenConfigured = hasSecretInput(account.config.callbackToken);
      const groupIdConfigured = Boolean(account.config.groupId?.trim());
      const publicDomainConfigured = Boolean(account.config.publicDomain?.trim());

      return {
        channel: "groupme",
        configured,
        statusLines: [
          `GroupMe (${accountId}): ${configured ? "configured" : "needs access token"}`,
          hasSecretInput(account.config.accessToken)
            ? "Access token configured"
            : "Access token missing",
          webhookPathConfigured ? "Webhook path configured" : "Webhook path missing",
          callbackTokenConfigured ? "Callback token configured" : "Callback token missing",
          publicDomainConfigured ? "Public domain configured" : "Public domain missing",
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
          validate: (value) => (value.trim() ? undefined : "Access token is required"),
        })
      ).trim();

      const groupsSpin = prompter.progress("Fetching your GroupMe groups...");
      let groups: Awaited<ReturnType<typeof fetchGroups>>;
      try {
        groups = await fetchGroupsImpl(accessToken);
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
          validate: validatePublicDomainInput,
        })
      ).trim();
      const publicDomain = requirePublicDomain(publicDomainRaw);

      const { webhookPath, callbackToken } = generateCallbackSettings();
      const pathSegment = webhookPath.split("/").pop() ?? webhookPath;
      await prompter.note(
        `Generated webhook URL path and token placeholder: /groupme/${pathSegment}?k=***`,
        "Generated webhook settings",
      );

      const botSpin = prompter.progress("Registering bot with GroupMe...");
      let botId = "";
      try {
        const bot = await createBotImpl({
          accessToken,
          name: botName,
          groupId,
          callbackUrl: buildPublicCallbackUrl({
            publicDomain,
            webhookPath,
            callbackToken,
          }),
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
          webhookPath,
          callbackToken,
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
    configureWhenConfigured: async ({ cfg, prompter, runtime, accountOverrides }) => {
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
          { value: "regen_callback", label: "Regenerate webhook settings" },
          { value: "toggle_mention", label: "Toggle requireMention" },
          { value: "update_domain", label: "Update public domain" },
          { value: "full_setup", label: "Full re-setup", hint: "start from scratch" },
        ],
      });

      if (action === "skip") {
        return "skip";
      }

      if (action === "full_setup") {
        return adapter.configure({
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
            validate: (value) => (value.trim() ? undefined : "Access token is required"),
          })
        ).trim();

        const spin = prompter.progress("Validating access token...");
        try {
          await fetchGroupsImpl(newToken);
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
            'No access token configured. Use "Rotate access token" first.',
            "Missing token",
          );
          return "skip";
        }

        const spin = prompter.progress("Fetching your GroupMe groups...");
        let groups: Awaited<ReturnType<typeof fetchGroups>>;
        try {
          groups = await fetchGroupsImpl(existingToken);
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
              message: "Bot ID for the new group (existing bot won't work in a different group)",
              validate: (value) => (value.trim() ? undefined : "Bot ID is required"),
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
                validate: validatePublicDomainInput,
              })
            ).trim();
            publicDomain = requirePublicDomain(domainRaw);
            updates.publicDomain = publicDomain;
          }
          let webhookPath = account.config.webhookPath?.trim();
          let callbackToken = readSecretInputString(account.config.callbackToken);
          const hasSecretBackedCallbackToken =
            !callbackToken && hasSecretInput(account.config.callbackToken);
          if (hasSecretBackedCallbackToken) {
            await prompter.note(
              [
                "Callback token is configured as a secret reference.",
                "Re-registering a GroupMe bot requires the literal callback token to build the callback URL.",
                "Regenerate webhook settings or update the bot outside this setup flow.",
              ].join("\n"),
              "Secret callback token",
            );
            return "skip";
          }
          if (!webhookPath || !callbackToken) {
            const generated = generateCallbackSettings();
            webhookPath = webhookPath || generated.webhookPath;
            callbackToken = callbackToken || generated.callbackToken;
            updates.webhookPath = webhookPath;
            updates.callbackToken = callbackToken;
          }

          const botSpin = prompter.progress("Registering bot with GroupMe...");
          try {
            const bot = await createBotImpl({
              accessToken: existingToken,
              name: botName,
              groupId: newGroupId,
              callbackUrl: buildPublicCallbackUrl({
                publicDomain,
                webhookPath,
                callbackToken,
              }),
            });
            updates.botId = bot.bot_id;
            botSpin.stop("Bot registered");
          } catch (error) {
            botSpin.stop("Failed");
            const detail = error instanceof Error ? `\n\nDetails: ${error.message}` : "";
            await prompter.note(`Failed to register bot.${detail}`, "Bot registration failed");
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
        const { webhookPath, callbackToken } = generateCallbackSettings();
        const next = applyGroupMeConfig({
          cfg,
          accountId,
          updates: { webhookPath, callbackToken },
        });
        await prompter.note(
          [
            "Webhook path and callback token regenerated.",
            "Remember to update your GroupMe bot settings or re-register the bot.",
          ].join("\n"),
          "Webhook settings updated",
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
            validate: validatePublicDomainInput,
          })
        ).trim();

        const publicDomain = requirePublicDomain(newDomainRaw);
        const next = applyGroupMeConfig({
          cfg,
          accountId,
          updates: { publicDomain },
        });
        await prompter.note(`Public domain updated to "${publicDomain}".`, "Domain updated");
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

  return adapter;
}

export const groupmeOnboardingAdapter = createGroupMeOnboardingAdapter();
