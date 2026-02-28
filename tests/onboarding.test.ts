import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { RuntimeEnv, WizardPrompter } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchGroupsMock = vi.hoisted(() => vi.fn());
const createBotMock = vi.hoisted(() => vi.fn());

vi.mock("../src/groupme-api.js", () => ({
  fetchGroups: fetchGroupsMock,
  createBot: createBotMock,
}));

import { groupmeOnboardingAdapter } from "../src/onboarding.js";

function makeConfig(): OpenClawConfig {
  return { channels: {} } as OpenClawConfig;
}

function makePrompter() {
  const progressSpins: Array<{ update: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const progress = vi.fn((_label: string) => {
    const spin = { update: vi.fn(), stop: vi.fn() };
    progressSpins.push(spin);
    return spin;
  });

  const prompter: WizardPrompter = {
    intro: vi.fn(async (_title: string) => undefined),
    outro: vi.fn(async (_message: string) => undefined),
    note: vi.fn(async (_message: string, _title?: string) => undefined),
    select: vi.fn(async () => "") as WizardPrompter["select"],
    multiselect: vi.fn(async () => []) as WizardPrompter["multiselect"],
    text: vi.fn(async (_params: unknown) => "") as WizardPrompter["text"],
    confirm: vi.fn(async (_params: unknown) => true),
    progress,
  };

  return {
    prompter,
    progressSpins,
  };
}

function makeRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: ((code: number) => {
      throw new Error(`exit(${code})`);
    }) as RuntimeEnv["exit"],
  };
}

function group(id: string, name: string) {
  return {
    id,
    name,
    description: "",
    image_url: null,
    creator_user_id: "u1",
    created_at: 1,
    updated_at: 1,
    messages: {
      count: 0,
      last_message_created_at: 0,
      preview: {
        nickname: "",
        text: "",
      },
    },
  };
}

describe("groupmeOnboardingAdapter.configure", () => {
  it("writes streamlined config after token-only onboarding flow", async () => {
    fetchGroupsMock.mockResolvedValueOnce([
      group("g1", "Family"),
      group("g2", "Work"),
    ]);
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
    expect(section.callbackUrl).toMatch(
      /^\/groupme\/[0-9a-f]{16}\?k=[0-9a-f]{64}$/,
    );

    expect(createBotMock).toHaveBeenCalledTimes(1);
    expect(createBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        name: "oddclaw",
        groupId: "g2",
        callbackUrl: `https://bot.example.com${section.callbackUrl as string}`,
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
        callbackUrl: "/groupme/abc123?k=secret",
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

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

    expect(result).toBe("skip");
  });

  it("rotates access token and validates it", async () => {
    fetchGroupsMock.mockResolvedValueOnce([group("g1", "Family")]);

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "rotate_token",
    );
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "new-token",
    );

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

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
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "rotate_token",
    );
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "bad-token",
    );

    await expect(
      groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      ),
    ).rejects.toThrow(/could not validate access token/i);
  });

  it("changes group and registers a new bot", async () => {
    fetchGroupsMock.mockResolvedValueOnce([
      group("g1", "Family"),
      group("g2", "Work"),
    ]);
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

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.groupId).toBe("g2");
    expect(section.botId).toBe("bot-new");
    expect(createBotMock).toHaveBeenCalledTimes(1);
  });

  it("changes group without re-registering bot", async () => {
    fetchGroupsMock.mockResolvedValueOnce([
      group("g1", "Family"),
      group("g2", "Work"),
    ]);

    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("change_group")
      .mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.groupId).toBe("g2");
    expect(section.botId).toBe("bot-existing");
    expect(createBotMock).not.toHaveBeenCalled();
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
          callbackUrl: "/groupme/abc123?k=secret",
          requireMention: true,
        },
      },
    } as OpenClawConfig;

    fetchGroupsMock.mockResolvedValueOnce([
      group("g1", "Family"),
      group("g2", "Work"),
    ]);
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

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter, noDomainCfg),
      );

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

  it("regenerates callback URL", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "regen_callback",
    );

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.callbackUrl).toMatch(
      /^\/groupme\/[0-9a-f]{16}\?k=[0-9a-f]{64}$/,
    );
    expect(section.callbackUrl).not.toBe("/groupme/abc123?k=secret");
  });

  it("toggles requireMention from true to false", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "toggle_mention",
    );

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.requireMention).toBe(false);
  });

  it("updates public domain", async () => {
    const { prompter } = makePrompter();
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "update_domain",
    );
    (prompter.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "https://new-domain.example.com/",
    );

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.publicDomain).toBe("new-domain.example.com");
  });

  it("rejects scheme-only input in update_domain via validation", async () => {
    const { prompter } = makePrompter();
    const textMock = prompter.text as ReturnType<typeof vi.fn>;

    // First call: returns "https://" which should fail validation, then returns a valid domain
    textMock.mockImplementationOnce(
      async (params: { validate?: (value: string) => string | undefined }) => {
        const error = params.validate?.("https://");
        expect(error).toBe("Public domain is required");
        return "valid.example.com";
      },
    );

    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "update_domain",
    );

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

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

    const result =
      await groupmeOnboardingAdapter.configureWhenConfigured!(
        configureWhenConfiguredCtx(prompter),
      );

    expect(result).not.toBe("skip");
    const { cfg } = result as { cfg: OpenClawConfig };
    const section = cfg.channels?.groupme as Record<string, unknown>;
    expect(section.botId).toBe("bot-fresh");
    expect(section.accessToken).toBe("fresh-token");
  });
});
