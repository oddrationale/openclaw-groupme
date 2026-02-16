import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";
import { groupmePlugin } from "../src/channel.js";
import type { GroupMeConfig } from "../src/types.js";

const setup = groupmePlugin.setup!;

function emptyCfg(): OpenClawConfig {
  return { channels: {} } as OpenClawConfig;
}

function cfgWith(groupme: GroupMeConfig): OpenClawConfig {
  return { channels: { groupme } } as OpenClawConfig;
}

function gmSection(cfg: OpenClawConfig): GroupMeConfig {
  return (cfg.channels?.groupme ?? {}) as GroupMeConfig;
}

describe("setup.validateInput", () => {
  it("rejects missing token", () => {
    const result = setup.validateInput!({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: {},
    });
    expect(result).toBeTypeOf("string");
    expect(result).toMatch(/bot id/i);
  });

  it("rejects blank token", () => {
    const result = setup.validateInput!({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "   " },
    });
    expect(result).toBeTypeOf("string");
  });

  it("accepts valid token", () => {
    const result = setup.validateInput!({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "abc123" },
    });
    expect(result).toBeNull();
  });
});

describe("setup.resolveAccountId", () => {
  it("returns 'default' for undefined", () => {
    const result = setup.resolveAccountId!({
      cfg: emptyCfg(),
      accountId: undefined,
    });
    expect(result).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("passes through explicit account id", () => {
    const result = setup.resolveAccountId!({
      cfg: emptyCfg(),
      accountId: "work",
    });
    expect(result).toBe("work");
  });
});

describe("setup.applyAccountName", () => {
  it("sets name on default account", () => {
    const result = setup.applyAccountName!({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      name: "My Bot",
    });
    const section = gmSection(result);
    expect(section.name).toBe("My Bot");
  });

  it("sets name on named account", () => {
    const result = setup.applyAccountName!({
      cfg: emptyCfg(),
      accountId: "work",
      name: "Work Bot",
    });
    const section = gmSection(result);
    expect(section.accounts?.work?.name).toBe("Work Bot");
  });
});

describe("setup.applyAccountConfig", () => {
  it("sets botId from token for default account", () => {
    const result = setup.applyAccountConfig({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "bot123" },
    });
    const section = gmSection(result);
    expect(section.botId).toBe("bot123");
    expect(section.enabled).toBe(true);
  });

  it("sets accessToken from accessToken", () => {
    const result = setup.applyAccountConfig({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "bot123", accessToken: "tok456" },
    });
    const section = gmSection(result);
    expect(section.accessToken).toBe("tok456");
  });

  it("sets callbackPath from webhookPath", () => {
    const result = setup.applyAccountConfig({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "bot123", webhookPath: "/gm/hook" },
    });
    const section = gmSection(result);
    expect(section.callbackPath).toBe("/gm/hook");
  });

  it("preserves existing config fields", () => {
    const cfg = cfgWith({ requireMention: true, botName: "mybot" });
    const result = setup.applyAccountConfig({
      cfg,
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "bot123" },
    });
    const section = gmSection(result);
    expect(section.requireMention).toBe(true);
    expect(section.botName).toBe("mybot");
    expect(section.botId).toBe("bot123");
  });

  it("omits optional fields that were not provided", () => {
    const result = setup.applyAccountConfig({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "bot123" },
    });
    const section = gmSection(result);
    expect(section.botId).toBe("bot123");
    expect("accessToken" in section).toBe(false);
    expect("callbackPath" in section).toBe(false);
  });

  it("creates accounts[id] entry for named account", () => {
    const result = setup.applyAccountConfig({
      cfg: emptyCfg(),
      accountId: "work",
      input: { token: "bot-work", accessToken: "tok-work" },
    });
    const section = gmSection(result);
    const account = section.accounts?.work;
    expect(account).toBeDefined();
    expect(account!.botId).toBe("bot-work");
    expect(account!.accessToken).toBe("tok-work");
    expect(account!.enabled).toBe(true);
  });

  it("sets top-level enabled for named account", () => {
    const result = setup.applyAccountConfig({
      cfg: emptyCfg(),
      accountId: "work",
      input: { token: "bot-work" },
    });
    const section = gmSection(result);
    expect(section.enabled).toBe(true);
  });
});
