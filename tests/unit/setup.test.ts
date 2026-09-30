import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import { groupmePlugin } from "../../src/channel.js";
import { groupmeSetupContract, groupmeSetupFields } from "../../src/setup-surface.js";
import type { GroupMeConfig } from "../../src/types.js";

type Contract = typeof groupmeSetupContract;

function requireFn<TKey extends keyof Contract>(key: TKey): NonNullable<Contract[TKey]> {
  const fn = groupmeSetupContract[key];
  if (!fn) {
    throw new Error(`expected setupContract.${String(key)}`);
  }
  return fn as NonNullable<Contract[TKey]>;
}

const validateInput = requireFn("validateInput");
const resolveAccountId = requireFn("resolveAccountId");
const applyAccountName = requireFn("applyAccountName");
const resolveBindingAccountId = requireFn("resolveBindingAccountId");
const applyAccountConfig = groupmeSetupContract.applyAccountConfig;

function emptyCfg(): OpenClawConfig {
  return { channels: {} } as OpenClawConfig;
}

function cfgWith(groupme: GroupMeConfig): OpenClawConfig {
  return { channels: { groupme } } as OpenClawConfig;
}

function gmSection(cfg: OpenClawConfig): GroupMeConfig {
  return (cfg.channels?.groupme ?? {}) as GroupMeConfig;
}

function apply(input: Record<string, unknown>, accountId = DEFAULT_ACCOUNT_ID, cfg = emptyCfg()) {
  return gmSection(applyAccountConfig({ cfg, accountId, input }));
}

describe("groupmeSetupContract shape", () => {
  it("is the channel-owned setup contract on the plugin", () => {
    expect(groupmeSetupContract.kind).toBe("channel-owned");
    expect(groupmePlugin.setupContract).toBe(groupmeSetupContract);
  });

  it("publishes every setup field with its key, CLI flag, and sensitivity", () => {
    expect(groupmeSetupContract.metadata.fields).toEqual(
      Object.entries(groupmeSetupFields).map(([key, field]) => ({ ...field, key })),
    );
    const sensitive = groupmeSetupContract.metadata.fields
      .filter((field) => "sensitive" in field && field.sensitive)
      .map((field) => field.key);
    expect(sensitive).toEqual(["botId", "token", "accessToken", "callbackToken", "webhookUrl"]);
    expect(groupmeSetupContract.metadata.fields.map((field) => field.cli.flags)).toEqual([
      "--bot-id <id>",
      "--token <bot-id>",
      "--access-token <token>",
      "--callback-token <token>",
      "--group-id <id>",
      "--bot-name <name>",
      "--webhook-path <path>",
      "--webhook-url <url>",
    ]);
  });
});

describe("setupContract.parseInput", () => {
  it("accepts the declared string fields plus name", () => {
    expect(
      groupmeSetupContract.parseInput({
        name: "Probe",
        botId: "bot-1",
        groupId: "123",
        webhookUrl: "https://bot.example.com/groupme?k=s",
        accessToken: undefined,
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Probe",
        botId: "bot-1",
        groupId: "123",
        webhookUrl: "https://bot.example.com/groupme?k=s",
      },
    });
  });

  it("rejects unknown options, wrong types, and non-object input", () => {
    expect(groupmeSetupContract.parseInput({ dmPolicy: "open" })).toEqual({
      ok: false,
      error: "Unsupported setup option: dmPolicy",
    });
    expect(groupmeSetupContract.parseInput({ botId: 123 })).toEqual({
      ok: false,
      error: "botId must be a string.",
    });
    expect(groupmeSetupContract.parseInput("bot-1").ok).toBe(false);
  });
});

describe("setupContract.validateInput", () => {
  it("rejects missing bot id", () => {
    const result = validateInput({ cfg: emptyCfg(), accountId: DEFAULT_ACCOUNT_ID, input: {} });
    expect(result).toBe("GroupMe bot ID is required (--bot-id <id>)");
  });

  it("rejects blank bot id and token", () => {
    const result = validateInput({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      input: { botId: "  ", token: "   " },
    });
    expect(result).toMatch(/bot id/i);
  });

  it("accepts --bot-id", () => {
    expect(
      validateInput({ cfg: emptyCfg(), accountId: DEFAULT_ACCOUNT_ID, input: { botId: "abc" } }),
    ).toBeNull();
  });

  it("accepts the --token alias", () => {
    expect(
      validateInput({
        cfg: emptyCfg(),
        accountId: DEFAULT_ACCOUNT_ID,
        input: { botId: " ", token: "abc123" },
      }),
    ).toBeNull();
  });

  it("reports parse errors before adapter validation", () => {
    expect(
      validateInput({
        cfg: emptyCfg(),
        accountId: DEFAULT_ACCOUNT_ID,
        input: { botId: "abc", unknownFlag: "x" },
      }),
    ).toBe("Unsupported setup option: unknownFlag");
  });
});

describe("setupContract.resolveAccountId", () => {
  it("returns 'default' for undefined", () => {
    expect(resolveAccountId({ cfg: emptyCfg(), accountId: undefined })).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("passes through and normalizes explicit account ids", () => {
    expect(resolveAccountId({ cfg: emptyCfg(), accountId: "work" })).toBe("work");
    expect(resolveAccountId({ cfg: emptyCfg(), accountId: "Work Bot" })).toBe("work-bot");
  });
});

describe("setupContract.applyAccountName", () => {
  it("sets name on default account", () => {
    const result = applyAccountName({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
      name: "My Bot",
    });
    expect(gmSection(result).name).toBe("My Bot");
  });

  it("sets name on named account", () => {
    const result = applyAccountName({ cfg: emptyCfg(), accountId: "work", name: "Work Bot" });
    expect(gmSection(result).accounts?.work?.name).toBe("Work Bot");
  });
});

describe("setupContract.resolveBindingAccountId", () => {
  it("returns explicit accountId when provided", () => {
    expect(resolveBindingAccountId({ cfg: emptyCfg(), agentId: "work", accountId: "ops" })).toBe(
      "ops",
    );
  });

  it("returns default for single-account setup", () => {
    expect(resolveBindingAccountId({ cfg: emptyCfg(), agentId: "work" })).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("returns configured defaultAccount for multi-account setup", () => {
    const cfg = cfgWith({
      defaultAccount: "ops",
      accounts: {
        ops: { botId: "bot-ops" },
        personal: { botId: "bot-personal" },
      },
    });
    expect(resolveBindingAccountId({ cfg, agentId: "work" })).toBe("ops");
  });

  it("returns undefined for multi-account setup without defaultAccount", () => {
    const cfg = cfgWith({
      defaultAccount: "  ",
      accounts: {
        ops: { botId: "bot-ops" },
        personal: { botId: "bot-personal" },
      },
    });
    expect(resolveBindingAccountId({ cfg, agentId: "work" })).toBeUndefined();
  });
});

describe("setupContract.applyAccountConfig", () => {
  it("sets botId from --bot-id for default account", () => {
    const section = apply({ botId: " bot123 " });
    expect(section.botId).toBe("bot123");
    expect(section.enabled).toBe(true);
  });

  it("sets botId from the --token alias", () => {
    expect(apply({ token: "bot123" }).botId).toBe("bot123");
  });

  it("prefers --bot-id over --token when both are given", () => {
    expect(apply({ botId: "from-bot-id", token: "from-token" }).botId).toBe("from-bot-id");
  });

  it("writes every provided field, trimmed", () => {
    const section = apply({
      name: "Probe",
      botId: "bot123",
      accessToken: " tok456 ",
      callbackToken: " cb ",
      groupId: " 42 ",
      botName: " oddclaw ",
      webhookPath: " /gm/hook ",
    });
    expect(section).toEqual({
      name: "Probe",
      enabled: true,
      botId: "bot123",
      accessToken: "tok456",
      callbackToken: "cb",
      groupId: "42",
      botName: "oddclaw",
      webhookPath: "/gm/hook",
    });
  });

  it("ignores blank optional fields", () => {
    const section = apply({
      botId: "bot123",
      accessToken: " ",
      callbackToken: "",
      groupId: " ",
      botName: " ",
      webhookUrl: " ",
    });
    expect(section).toEqual({ enabled: true, botId: "bot123" });
  });

  it("sets webhookPath from a bare --webhook-url path", () => {
    expect(apply({ botId: "bot123", webhookUrl: "/gm/hook" }).webhookPath).toBe("/gm/hook");
  });

  it("extracts the ?k= callback token from --webhook-url while saving only the path", () => {
    const section = apply({
      botId: "bot123",
      webhookUrl: "https://bot.example.com/gm/hook?k=secret#frag",
    });
    expect(section.webhookPath).toBe("/gm/hook");
    expect(section.callbackToken).toBe("secret");
  });

  it("keeps an explicit --callback-token over the ?k= query value", () => {
    const section = apply({
      botId: "bot123",
      callbackToken: "explicit",
      webhookUrl: "https://bot.example.com/gm/hook?k=from-url",
    });
    expect(section.callbackToken).toBe("explicit");
  });

  it("ignores a blank ?k= value", () => {
    const section = apply({ botId: "bot123", webhookUrl: "https://bot.example.com/gm?k=%20" });
    expect(section.webhookPath).toBe("/gm");
    expect("callbackToken" in section).toBe(false);
  });

  it("prefers --webhook-url over --webhook-path", () => {
    expect(apply({ botId: "b", webhookUrl: "/from-url", webhookPath: "/from-path" })).toEqual(
      expect.objectContaining({ webhookPath: "/from-url" }),
    );
  });

  it("migrates callback token from a --webhook-path that carries a query", () => {
    const section = apply({ botId: "bot123", webhookPath: "/gm/hook?k=secret#frag" });
    expect(section.webhookPath).toBe("/gm/hook");
    expect(section.callbackToken).toBe("secret");
  });

  it("falls back to a sanitized path when the webhook url cannot be parsed", () => {
    expect(apply({ botId: "bot123", webhookUrl: "http://%" }).webhookPath).toBe("/http://%");
  });

  it("preserves existing config fields", () => {
    const section = apply(
      { token: "bot123" },
      DEFAULT_ACCOUNT_ID,
      cfgWith({ requireMention: true, botName: "mybot" }),
    );
    expect(section.requireMention).toBe(true);
    expect(section.botName).toBe("mybot");
    expect(section.botId).toBe("bot123");
  });

  it("omits optional fields that were not provided", () => {
    const section = apply({ token: "bot123" });
    expect(section.botId).toBe("bot123");
    expect("accessToken" in section).toBe(false);
    expect("webhookPath" in section).toBe(false);
    expect("callbackToken" in section).toBe(false);
  });

  it("creates accounts[id] entry for named account", () => {
    const section = apply({ token: "bot-work", accessToken: "tok-work" }, "work");
    const account = section.accounts?.work;
    expect(account).toEqual({ enabled: true, botId: "bot-work", accessToken: "tok-work" });
    expect(section.enabled).toBe(true);
    expect("botId" in section).toBe(false);
  });

  it("merges into an existing named account and keeps sibling accounts", () => {
    const section = apply(
      { groupId: "99" },
      "work",
      cfgWith({
        accounts: {
          work: { botId: "bot-work", botName: "worker" },
          home: { botId: "bot-home" },
        },
      }),
    );
    expect(section.accounts?.work).toEqual({
      enabled: true,
      botId: "bot-work",
      botName: "worker",
      groupId: "99",
    });
    expect(section.accounts?.home).toEqual({ botId: "bot-home" });
  });

  it("moves a top-level name to the default account when adding a named account", () => {
    const section = apply(
      { token: "bot-work", name: "Work" },
      "work",
      cfgWith({ name: "Base", botId: "bot-base" }),
    );
    expect(section.name).toBeUndefined();
    expect(section.botId).toBe("bot-base");
    expect(section.accounts?.default?.name).toBe("Base");
    expect(section.accounts?.work).toEqual({ name: "Work", enabled: true, botId: "bot-work" });
  });

  it("throws on input that does not match the declared fields", () => {
    expect(() => apply({ botId: 42 })).toThrow("botId must be a string.");
  });
});
