import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { group, makePrompter, makeRuntime } from "../helpers/onboarding.js";

const fetchGroupsMock = vi.hoisted(() => vi.fn());
const createBotMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/groupme-api.js", () => ({
  fetchGroups: fetchGroupsMock,
  createBot: createBotMock,
}));

import { groupmeOnboardingAdapter } from "../../src/onboarding.js";

function configureWhenConfigured(
  params: Parameters<NonNullable<typeof groupmeOnboardingAdapter.configureWhenConfigured>>[0],
) {
  const configure = groupmeOnboardingAdapter.configureWhenConfigured;
  if (!configure) {
    throw new Error("expected configureWhenConfigured adapter");
  }
  return configure(params);
}

function makeConfig(): OpenClawConfig {
  return { channels: {} } as OpenClawConfig;
}

describe("groupmeOnboardingAdapter.configure", () => {
  it("reports status with secret-object callback token and missing fields", async () => {
    const status = await groupmeOnboardingAdapter.getStatus({
      cfg: {
        channels: {
          groupme: {
            botId: "bot-1",
            callbackToken: { source: "env", provider: "default", id: "GROUPME_CALLBACK_TOKEN" },
          },
        },
      } as OpenClawConfig,
      accountOverrides: { groupme: "work" },
    });

    expect(status).toEqual(
      expect.objectContaining({
        channel: "groupme",
        configured: true,
        selectionHint: "configured",
        quickstartScore: 1,
      }),
    );
    expect(status.statusLines).toContain("Access token missing");
    expect(status.statusLines).toContain("Callback token configured");
  });

  it("reports an unconfigured status and falls back to the default account", async () => {
    const status = await groupmeOnboardingAdapter.getStatus({
      cfg: { channels: {} } as OpenClawConfig,
      accountOverrides: {},
    });

    expect(status.configured).toBe(false);
    expect(status.selectionHint).toBe("needs access token");
    expect(status.quickstartScore).toBe(0);
    expect(status.statusLines[0]).toContain("(default)");
    expect(status.statusLines).toContain("Callback token missing");
  });

  it("reports configured status for the default account", async () => {
    const status = await groupmeOnboardingAdapter.getStatus({
      cfg: makeConfiguredConfig(),
      accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
    });

    expect(status.configured).toBe(true);
    expect(status.selectionHint).toBe("configured");
    expect(status.quickstartScore).toBe(1);
    expect(status.statusLines).toContain("Access token configured");
    expect(status.statusLines).toContain("Webhook path configured");
  });

  it("writes streamlined config after token-only onboarding flow", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-1234567890",
      group_id: "g2",
      name: "oddclaw",
      avatar_url: null,
      callback_url: "https://bot.example.com/groupme/test",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("oddclaw")
      .mockResolvedValueOnce("access-token")
      .mockResolvedValueOnce("https://bot.example.com/");
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const result = await groupmeOnboardingAdapter.configure({
      cfg: makeConfig(),
      runtime: makeRuntime(),
      prompter,
      options: {},
      accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
    });

    const section = result.cfg.channels?.groupme as Record<string, unknown>;
    expect(result.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(section.botId).toBe("bot-1234567890");
    expect(section.accessToken).toBe("access-token");
    expect(section.botName).toBe("oddclaw");
    expect(section.groupId).toBe("g2");
    expect(section.publicDomain).toBe("bot.example.com");
    expect(section.requireMention).toBe(false);
    expect(section.webhookPath).toMatch(/^\/groupme\/[0-9a-f]{16}$/);
    expect(section.callbackToken).toMatch(/^[0-9a-f]{64}$/);

    expect(createBotMock).toHaveBeenCalledTimes(1);
    expect(createBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        name: "oddclaw",
        groupId: "g2",
        callbackUrl: `https://bot.example.com${section.webhookPath as string}?k=${section.callbackToken as string}`,
      }),
    );
    expect(prompter.note).toHaveBeenCalledWith(
      [
        "Next steps:",
        "1. Restart the gateway: openclaw gateway restart",
        "2. Send a message in the group to test",
      ].join("\n"),
      "GroupMe next steps",
    );
  });

  it("aborts when fetching groups fails", async () => {
    fetchGroupsMock.mockRejectedValueOnce(new Error("401"));

    const { prompter, progressSpins } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("openclaw")
      .mockResolvedValueOnce("bad-token");

    await expect(
      groupmeOnboardingAdapter.configure({
        cfg: makeConfig(),
        runtime: makeRuntime(),
        prompter,
        options: {},
        accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
        shouldPromptAccountIds: false,
        forceAllowFrom: false,
      }),
    ).rejects.toThrow(/could not fetch groups/i);

    expect(progressSpins[0]?.stop).toHaveBeenCalledWith("Failed");
    expect(prompter.note).toHaveBeenCalledWith(
      "Could not fetch groups. Check your access token and try again.",
      "GroupMe setup failed",
    );
  });

  it("aborts when no groups are available", async () => {
    fetchGroupsMock.mockResolvedValueOnce([]);

    const { prompter, progressSpins } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("openclaw")
      .mockResolvedValueOnce("access-token");

    await expect(
      groupmeOnboardingAdapter.configure({
        cfg: makeConfig(),
        runtime: makeRuntime(),
        prompter,
        options: {},
        accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
        shouldPromptAccountIds: false,
        forceAllowFrom: false,
      }),
    ).rejects.toThrow(/no groupme groups/i);

    expect(progressSpins[0]?.stop).toHaveBeenCalledWith("No groups found");
    expect(prompter.note).toHaveBeenCalledWith(
      "No groups found. Create or join a GroupMe group first.",
      "GroupMe setup failed",
    );
  });

  it("aborts when bot registration fails and includes the API detail", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family")]);
    createBotMock.mockRejectedValueOnce(new Error("callback rejected"));

    const { prompter, progressSpins } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("access-token")
      .mockResolvedValueOnce("https://bot.example.com/path");
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("g1");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await expect(
      groupmeOnboardingAdapter.configure({
        cfg: makeConfig(),
        runtime: makeRuntime(),
        prompter,
        options: {},
        accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
        shouldPromptAccountIds: false,
        forceAllowFrom: false,
      }),
    ).rejects.toThrow(/failed to register/i);

    expect(progressSpins[1]?.stop).toHaveBeenCalledWith("Failed");
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Details: callback rejected"),
      "GroupMe setup failed",
    );
  });

  it("validates required setup fields before accepting prompt values", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-123",
      group_id: "g1",
      name: "openclaw",
      avatar_url: null,
      callback_url: "https://bot.example.com/groupme/test",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    const textMock = prompter.text as ReturnType<typeof vi.fn>;
    textMock
      .mockResolvedValueOnce("openclaw")
      .mockImplementationOnce(
        async (params: { validate?: (value: string) => string | undefined }) => {
          expect(params.validate?.("   ")).toBe("Access token is required");
          return "access-token";
        },
      )
      .mockImplementationOnce(
        async (params: { validate?: (value: string) => string | undefined }) => {
          expect(params.validate?.("")).toBe("Public domain is required");
          expect(params.validate?.("https://")).toBe("Public domain must be a valid host");
          expect(params.validate?.("https://broken host/path")).toBe(
            "Public domain must be a valid host",
          );
          // ":" survives the cheap character check but fails URL host parsing,
          // exercising parsePublicDomain's final catch.
          expect(params.validate?.(":")).toBe("Public domain must be a valid host");
          // A clean host returns no error (validation success path).
          expect(params.validate?.("bot.example.com")).toBeUndefined();
          return "https://bot.example.com/path?x=1";
        },
      );
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("g1");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await groupmeOnboardingAdapter.configure({
      cfg: makeConfig(),
      runtime: makeRuntime(),
      prompter,
      options: {},
      accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
    });

    const section = result.cfg.channels?.groupme as Record<string, unknown>;
    expect(section.publicDomain).toBe("bot.example.com");
  });

  it("describes generated callback settings as a URL path with token placeholder", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-123",
      group_id: "g1",
      name: "openclaw",
      avatar_url: null,
      callback_url: "https://bot.example.com/groupme/test",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("openclaw")
      .mockResolvedValueOnce("access-token")
      .mockResolvedValueOnce("bot.example.com");
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("g1");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await groupmeOnboardingAdapter.configure({
      cfg: makeConfig(),
      runtime: makeRuntime(),
      prompter,
      options: {},
      accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
    });

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Generated webhook URL path and token placeholder: \/groupme\/[0-9a-f]{16}\?k=\*\*\*$/,
      ),
      "Generated webhook settings",
    );
  });

  it("writes named account config during onboarding", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-work",
      group_id: "g1",
      name: "openclaw",
      avatar_url: null,
      callback_url: "https://bot.example.com/groupme/test",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("access-token")
      .mockResolvedValueOnce("bot.example.com");
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("g1");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await groupmeOnboardingAdapter.configure({
      cfg: makeConfig(),
      runtime: makeRuntime(),
      prompter,
      options: {},
      accountOverrides: { groupme: "work" },
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
    });

    const section = result.cfg.channels?.groupme as {
      accounts?: Record<string, { botId?: string }>;
    };
    expect(result.accountId).toBe("work");
    expect(section.accounts?.work?.botId).toBe("bot-work");
  });
});

function makeConfiguredConfig(): OpenClawConfig {
  return {
    channels: {
      groupme: {
        enabled: true,
        botId: "bot-existing",
        accessToken: "token-existing",
        botName: "oddclaw",
        groupId: "g1",
        publicDomain: "bot.example.com",
        webhookPath: "/groupme/abc123",
        callbackToken: "secret",
        requireMention: true,
      },
    },
  } as OpenClawConfig;
}

function configureWhenConfiguredCtx(prompter: WizardPrompter, cfg?: OpenClawConfig) {
  return {
    cfg: cfg ?? makeConfiguredConfig(),
    runtime: makeRuntime(),
    prompter,
    options: {},
    accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
    shouldPromptAccountIds: false,
    forceAllowFrom: false,
    configured: true,
    label: "GroupMe",
  };
}

describe("groupmeOnboardingAdapter.configureWhenConfigured", () => {
  beforeEach(() => {
    fetchGroupsMock.mockReset();
    createBotMock.mockReset();
  });

  it("returns skip when user selects skip", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("skip");

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).toBe("skip");
  });

  it("rotates access token and validates it", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family")]);

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("rotate_token");
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce("new-token");

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg, accountId } = result as { cfg: OpenClawConfig; accountId: string };
    expect(accountId).toBe(DEFAULT_ACCOUNT_ID);
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.accessToken).toBe("new-token");
    expect(section.botId).toBe("bot-existing");
    expect(fetchGroupsMock).toHaveBeenCalledWith("new-token");
  });

  it("aborts token rotation when validation fails", async () => {
    fetchGroupsMock.mockRejectedValueOnce(new Error("401"));

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("rotate_token");
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce("bad-token");

    await expect(configureWhenConfigured(configureWhenConfiguredCtx(prompter))).rejects.toThrow(
      /could not validate access token/i,
    );
  });

  it("validates token rotation input before saving it", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family")]);

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("rotate_token");
    (prompter.text as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (params: { validate?: (value: string) => string | undefined }) => {
        expect(params.validate?.("")).toBe("Access token is required");
        return "new-token";
      },
    );

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.accessToken).toBe("new-token");
  });

  it("changes group and registers a new bot", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-new",
      group_id: "g2",
      name: "oddclaw",
      avatar_url: null,
      callback_url: "https://bot.example.com/groupme/abc123",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.groupId).toBe("g2");
    expect(section.botId).toBe("bot-new");
    expect(createBotMock).toHaveBeenCalledTimes(1);
  });

  it("returns skip when changing group without an access token", async () => {
    const missingTokenCfg = {
      channels: {
        groupme: {
          enabled: true,
          botId: "bot-existing",
          botName: "oddclaw",
          groupId: "g1",
        },
      },
    } as OpenClawConfig;
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("change_group");

    const result = await configureWhenConfigured(
      configureWhenConfiguredCtx(prompter, missingTokenCfg),
    );

    expect(result).toBe("skip");
    expect(prompter.note).toHaveBeenCalledWith(
      'No access token configured. Use "Rotate access token" first.',
      "Missing token",
    );
  });

  it("aborts change_group when fetching groups fails", async () => {
    fetchGroupsMock.mockRejectedValueOnce(new Error("401"));
    const { prompter, progressSpins } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("change_group");

    await expect(configureWhenConfigured(configureWhenConfiguredCtx(prompter))).rejects.toThrow(
      /could not fetch groups/i,
    );

    expect(progressSpins[0]?.stop).toHaveBeenCalledWith("Failed");
    expect(prompter.note).toHaveBeenCalledWith(
      "Could not fetch groups. Check your access token and try again.",
      "GroupMe error",
    );
  });

  it("returns skip when change_group finds no groups", async () => {
    fetchGroupsMock.mockResolvedValueOnce([]);
    const { prompter, progressSpins } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("change_group");

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).toBe("skip");
    expect(progressSpins[0]?.stop).toHaveBeenCalledWith("No groups found");
    expect(prompter.note).toHaveBeenCalledWith(
      "No groups found. Create or join a GroupMe group first.",
      "No groups",
    );
  });

  it("changes group without re-registering bot prompts for botId", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce("bot-for-g2");

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.groupId).toBe("g2");
    expect(section.botId).toBe("bot-for-g2");
    expect(createBotMock).not.toHaveBeenCalled();
  });

  it("validates bot id when changing groups without registering a bot", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    (prompter.text as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (params: { validate?: (value: string) => string | undefined }) => {
        expect(params.validate?.("")).toBe("Bot ID is required");
        return "bot-for-g2";
      },
    );

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
  });

  it("prompts for publicDomain when missing during change_group with bot registration", async () => {
    const noDomainCfg = {
      channels: {
        groupme: {
          enabled: true,
          botId: "bot-existing",
          accessToken: "token-existing",
          botName: "oddclaw",
          groupId: "g1",
          webhookPath: "/groupme/abc123",
          callbackToken: "secret",
          requireMention: true,
        },
      },
    } as OpenClawConfig;

    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-new",
      group_id: "g2",
      name: "oddclaw",
      avatar_url: null,
      callback_url: "https://prompted.example.com/groupme/abc123",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "https://prompted.example.com/",
    );

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter, noDomainCfg));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.groupId).toBe("g2");
    expect(section.botId).toBe("bot-new");
    expect(section.publicDomain).toBe("prompted.example.com");
    expect(createBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: expect.stringContaining("https://prompted.example.com/"),
      }),
    );
  });

  it("validates prompted publicDomain during change_group bot registration", async () => {
    const noDomainCfg = {
      channels: {
        groupme: {
          enabled: true,
          botId: "bot-existing",
          accessToken: "token-existing",
          botName: "oddclaw",
          groupId: "g1",
          webhookPath: "/groupme/abc123",
          callbackToken: "secret",
          requireMention: true,
        },
      },
    } as OpenClawConfig;

    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-new",
      group_id: "g2",
      name: "oddclaw",
      avatar_url: null,
      callback_url: "https://prompted.example.com/groupme/abc123",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (prompter.text as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (params: { validate?: (value: string) => string | undefined }) => {
        expect(params.validate?.("")).toBe("Public domain is required");
        expect(params.validate?.("https://")).toBe("Public domain must be a valid host");
        expect(params.validate?.("broken host")).toBe("Public domain must be a valid host");
        return "https://prompted.example.com/";
      },
    );

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter, noDomainCfg));

    expect(result).not.toBe("skip");
  });

  it("aborts change_group when bot registration fails", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);
    createBotMock.mockRejectedValueOnce(new Error("callback rejected"));

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await expect(configureWhenConfigured(configureWhenConfiguredCtx(prompter))).rejects.toThrow(
      /failed to register/i,
    );

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Details: callback rejected"),
      "Bot registration failed",
    );
  });

  it("persists generated webhook settings when missing during change_group bot registration", async () => {
    const noCallbackCfg = {
      channels: {
        groupme: {
          enabled: true,
          botId: "bot-existing",
          accessToken: "token-existing",
          botName: "oddclaw",
          groupId: "g1",
          publicDomain: "bot.example.com",
          requireMention: true,
        },
      },
    } as OpenClawConfig;

    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-new",
      group_id: "g2",
      name: "oddclaw",
      avatar_url: null,
      callback_url: "https://bot.example.com/groupme/test",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await configureWhenConfigured(
      configureWhenConfiguredCtx(prompter, noCallbackCfg),
    );

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.webhookPath).toMatch(/^\/groupme\/[0-9a-f]{16}$/);
    expect(section.callbackToken).toMatch(/^[0-9a-f]{64}$/);
    expect(createBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: expect.stringContaining("https://bot.example.com/groupme/"),
      }),
    );
  });

  it("does not overwrite secret-backed callback tokens during change_group bot registration", async () => {
    const secretCallbackCfg = {
      channels: {
        groupme: {
          enabled: true,
          botId: "bot-existing",
          accessToken: "token-existing",
          botName: "oddclaw",
          groupId: "g1",
          publicDomain: "bot.example.com",
          webhookPath: "/groupme/abc123",
          callbackToken: {
            source: "env",
            provider: "default",
            id: "GROUPME_CALLBACK_TOKEN",
          },
          requireMention: true,
        },
      },
    } as OpenClawConfig;

    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family"), group("g2", "Work")]);

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await configureWhenConfigured(
      configureWhenConfiguredCtx(prompter, secretCallbackCfg),
    );

    expect(result).toBe("skip");
    expect(createBotMock).not.toHaveBeenCalled();
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Callback token is configured as a secret reference."),
      "Secret callback token",
    );
  });

  it("regenerates webhook settings", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("regen_callback");

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.webhookPath).toMatch(/^\/groupme\/[0-9a-f]{16}$/);
    expect(section.callbackToken).toMatch(/^[0-9a-f]{64}$/);
    expect(section.webhookPath).not.toBe("/groupme/abc123");
    expect(section.callbackToken).not.toBe("secret");
  });

  it("toggles requireMention from true to false", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("toggle_mention");

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.requireMention).toBe(false);
  });

  it("updates public domain", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("update_domain");
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "https://new-domain.example.com/",
    );

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.publicDomain).toBe("new-domain.example.com");
  });

  it("rejects malformed public domain returned by a custom prompter", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("update_domain");
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce("https://broken host/path");

    await expect(configureWhenConfigured(configureWhenConfiguredCtx(prompter))).rejects.toThrow(
      "Invalid public domain",
    );
  });

  it("rejects scheme-only input in update_domain via validation", async () => {
    const { prompter } = makePrompter();
    const textMock = prompter.text as ReturnType<typeof vi.fn>;

    // First call: returns "https://" which should fail validation, then returns a valid domain
    textMock.mockImplementationOnce(
      async (params: { validate?: (value: string) => string | undefined }) => {
        const error = params.validate?.("https://");
        expect(error).toBe("Public domain must be a valid host");
        return "valid.example.com";
      },
    );

    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("update_domain");

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.publicDomain).toBe("valid.example.com");
  });

  it("delegates to full re-setup when selected", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family")]);
    createBotMock.mockResolvedValueOnce({
      bot_id: "bot-fresh",
      group_id: "g1",
      name: "openclaw",
      avatar_url: null,
      callback_url: "https://new.example.com/groupme/test",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("full_setup")
      .mockResolvedValueOnce("g1");
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("openclaw")
      .mockResolvedValueOnce("fresh-token")
      .mockResolvedValueOnce("https://new.example.com/");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await configureWhenConfigured(configureWhenConfiguredCtx(prompter));

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.botId).toBe("bot-fresh");
    expect(section.accessToken).toBe("fresh-token");
  });

  it("returns skip for unknown configured action values", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("unknown-action");

    await expect(configureWhenConfigured(configureWhenConfiguredCtx(prompter))).resolves.toBe(
      "skip",
    );
  });

  it("disables the channel", () => {
    const disabled = groupmeOnboardingAdapter.disable?.(makeConfiguredConfig());
    const section = disabled?.channels?.groupme as Record<string, unknown>;

    expect(section.enabled).toBe(false);
    expect(section.botId).toBe("bot-existing");
  });
});
