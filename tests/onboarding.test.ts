import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { RuntimeEnv, WizardPrompter } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

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
      callback_url: "https://example.com/groupme/test",
      dm_notification: false,
      active: true,
    });

    const { prompter } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("oddclaw")
      .mockResolvedValueOnce("access-token");
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
        callbackUrl: "https://example.com",
      }),
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
