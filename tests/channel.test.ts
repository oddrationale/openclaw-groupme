// @ts-nocheck
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGroupMeRuntime } from "../src/runtime.js";
import type { CoreConfig, ResolvedGroupMeAccount } from "../src/types.js";

const registerPluginHttpRouteMock = vi.hoisted(() => vi.fn());
const sendGroupMeTextMock = vi.hoisted(() => vi.fn());
const sendGroupMeMediaMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/webhook-ingress", () => ({
  registerPluginHttpRoute: registerPluginHttpRouteMock,
}));

vi.mock("../src/send.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/send.js")>();
  return {
    ...actual,
    sendGroupMeText: sendGroupMeTextMock,
    sendGroupMeMedia: sendGroupMeMediaMock,
  };
});

import { groupmePlugin } from "../src/channel.js";

function cfg(groupme: CoreConfig["channels"]["groupme"]): CoreConfig {
  return { channels: { groupme } } as CoreConfig;
}

function account(overrides: Partial<ResolvedGroupMeAccount> = {}): ResolvedGroupMeAccount {
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    name: "Default GroupMe",
    enabled: true,
    configured: true,
    botId: "bot-1",
    accessToken: "token-1",
    config: {
      botId: "bot-1",
      accessToken: "token-1",
      callbackToken: "callback-secret",
      webhookPath: "/groupme/custom?k=legacy",
      publicDomain: "bot.example.com",
      allowFrom: ["u1", "*", " groupme:user:u2 ", ""],
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  setGroupMeRuntime(undefined as unknown as Parameters<typeof setGroupMeRuntime>[0]);
});

describe("groupmePlugin.config", () => {
  it("lists and resolves accounts through the plugin config adapter", () => {
    const coreCfg = cfg({
      defaultAccount: "work",
      botId: "base-bot",
      allowFrom: ["u1"],
      accounts: {
        work: { botId: "work-bot", requireMention: false, allowFrom: ["u2"] },
      },
    });

    expect(groupmePlugin.config.listAccountIds(coreCfg)).toEqual(["default", "work"]);
    expect(groupmePlugin.config.defaultAccountId(coreCfg)).toBe("work");
    expect(groupmePlugin.config.resolveAccount(coreCfg, "work")).toEqual(
      expect.objectContaining({
        accountId: "work",
        botId: "work-bot",
        configured: true,
      }),
    );
    expect(groupmePlugin.config.isConfigured(account())).toBe(true);
    expect(groupmePlugin.config.resolveAllowFrom({ cfg: coreCfg, accountId: "work" })).toEqual([
      "u2",
    ]);
    expect(groupmePlugin.groups.resolveRequireMention({ cfg: coreCfg, accountId: "work" })).toBe(
      false,
    );
  });

  it("describes configured accounts without leaking secrets and normalizes webhook paths", () => {
    const described = groupmePlugin.config.describeAccount(account());

    expect(described).toEqual({
      accountId: DEFAULT_ACCOUNT_ID,
      name: "Default GroupMe",
      enabled: true,
      configured: true,
      botId: "***",
      publicDomain: "bot.example.com",
      webhookPath: "/groupme/custom",
      callbackToken: "***",
    });
  });

  it("describes secret input objects as configured without leaking them", () => {
    const described = groupmePlugin.config.describeAccount(
      account({
        botId: "",
        accessToken: "",
        config: {
          botId: { source: "env", provider: "default", id: "GROUPME_BOT_ID" },
          accessToken: { source: "env", provider: "default", id: "GROUPME_ACCESS_TOKEN" },
          callbackToken: {
            source: "env",
            provider: "default",
            id: "GROUPME_CALLBACK_TOKEN",
          },
        },
      }),
    );

    expect(described.botId).toBe("***");
    expect(described.callbackToken).toBe("***");
  });

  it("uses safe defaults when optional account fields are missing", () => {
    const described = groupmePlugin.config.describeAccount(
      account({
        name: undefined,
        enabled: false,
        configured: false,
        botId: "",
        config: {},
      }),
    );

    expect(described.name).toBeUndefined();
    expect(described.enabled).toBe(false);
    expect(described.configured).toBe(false);
    expect(described.botId).toBe("");
    expect(described.webhookPath).toBe("/groupme");
    expect(described.callbackToken).toBe("");
  });

  it("falls back when webhookPath cannot be parsed as a URL", () => {
    const described = groupmePlugin.config.describeAccount(
      account({
        config: {
          webhookPath: "http://%",
        },
      }),
    );

    expect(described.webhookPath).toBe("/http://%");
  });

  it("formats allowFrom entries and filters invalid values", () => {
    const formatted = groupmePlugin.config.formatAllowFrom({
      allowFrom: ["u1", " groupme:user:u2 ", "", "groupme:group:g1"],
    });

    expect(formatted).toEqual(["u1", "u2", "g1"]);
  });

  it("lists configured peers from allowFrom with query and limit applied", async () => {
    const peers = await groupmePlugin.directory.listPeers({
      cfg: cfg({
        botId: "bot-1",
        allowFrom: ["u1", "*", "work-user", "home-user"],
      }),
      accountId: DEFAULT_ACCOUNT_ID,
      query: "user",
      limit: 1,
    });

    expect(peers).toEqual([{ kind: "user", id: "work-user" }]);
  });

  it("can enable, disable, and delete account config", () => {
    const base = cfg({
      enabled: true,
      botId: "base-bot",
      callbackToken: "secret",
      accounts: {
        work: {
          botId: "work-bot",
          enabled: true,
        },
      },
    });

    const disabled = groupmePlugin.config.setAccountEnabled({
      cfg: base,
      accountId: "work",
      enabled: false,
    }) as CoreConfig;
    expect(disabled.channels.groupme.accounts?.work?.enabled).toBe(false);

    const deleted = groupmePlugin.config.deleteAccount({
      cfg: disabled,
      accountId: DEFAULT_ACCOUNT_ID,
    }) as CoreConfig;
    expect(deleted.channels.groupme.botId).toBeUndefined();
    expect(deleted.channels.groupme.callbackToken).toBeUndefined();
    expect(deleted.channels.groupme.accounts?.work?.botId).toBe("work-bot");
  });
});

describe("groupmePlugin outbound and resolver", () => {
  it("normalizes valid outbound targets and reports a helpful error for empty targets", () => {
    expect(groupmePlugin.outbound.resolveTarget({ to: " groupme:group:g1 " })).toEqual({
      ok: true,
      to: "g1",
    });

    const missing = groupmePlugin.outbound.resolveTarget({ to: " " });
    expect(missing.ok).toBe(false);
    if (missing.ok) {
      throw new Error("expected missing target");
    }
    expect(missing.error.message).toMatch(/GroupMe/);
  });

  it("chunks markdown through the OpenClaw runtime", () => {
    const chunkMarkdownText = vi.fn(() => ["one", "two"]);
    setGroupMeRuntime({
      channel: {
        text: {
          chunkMarkdownText,
        },
      },
    } as unknown as Parameters<typeof setGroupMeRuntime>[0]);

    expect(groupmePlugin.outbound.chunker("hello", 5)).toEqual(["one", "two"]);
    expect(chunkMarkdownText).toHaveBeenCalledWith("hello", 5);
  });

  it("delegates text and media sends to the GroupMe send helpers", async () => {
    sendGroupMeTextMock.mockResolvedValueOnce({ messageId: "m1", timestamp: 100 });
    sendGroupMeMediaMock.mockResolvedValueOnce({ messageId: "m2", timestamp: 200 });
    const coreCfg = cfg({ botId: "bot-1", accessToken: "token-1" });

    await expect(
      groupmePlugin.outbound.sendText({
        cfg: coreCfg,
        to: "groupme:group:g1",
        text: "hello",
        accountId: DEFAULT_ACCOUNT_ID,
      }),
    ).resolves.toEqual({ channel: "groupme", messageId: "m1", timestamp: 100 });

    await expect(
      groupmePlugin.outbound.sendMedia({
        cfg: coreCfg,
        to: "groupme:group:g1",
        text: "image",
        mediaUrl: "https://example.com/image.png",
        accountId: DEFAULT_ACCOUNT_ID,
      }),
    ).resolves.toEqual({ channel: "groupme", messageId: "m2", timestamp: 200 });

    expect(sendGroupMeTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "hello", to: "groupme:group:g1" }),
    );
    expect(sendGroupMeMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: "https://example.com/image.png" }),
    );
  });

  it("rejects media sends without a mediaUrl before calling the API", async () => {
    await expect(
      groupmePlugin.outbound.sendMedia({
        cfg: cfg({ botId: "bot-1", accessToken: "token-1" }),
        to: "groupme:group:g1",
        text: "image",
        mediaUrl: "",
        accountId: DEFAULT_ACCOUNT_ID,
      }),
    ).rejects.toThrow("mediaUrl");
    expect(sendGroupMeMediaMock).not.toHaveBeenCalled();
  });

  it("resolves targets and marks user lookups as group-only", async () => {
    const resolved = await groupmePlugin.resolver.resolveTargets({
      inputs: ["g1", "", "groupme:group:g2"],
      kind: "user",
    });

    expect(resolved).toEqual([
      {
        input: "g1",
        resolved: true,
        id: "g1",
        name: "g1",
        note: "GroupMe bots are group-only",
      },
      { input: "", resolved: false, note: "empty target" },
      {
        input: "groupme:group:g2",
        resolved: true,
        id: "g2",
        name: "g2",
        note: "GroupMe bots are group-only",
      },
    ]);
  });

  it("exposes target normalization helpers and directory defaults", async () => {
    expect(groupmePlugin.messaging.normalizeTarget("groupme:group:g1")).toBe("g1");
    expect(groupmePlugin.messaging.targetResolver.looksLikeId("groupme:group:g1")).toBe(true);
    expect(groupmePlugin.messaging.targetResolver.hint).toBe("<group-id>");
    await expect(groupmePlugin.directory.self()).resolves.toBeNull();
    await expect(groupmePlugin.directory.listGroups()).resolves.toEqual([]);
  });
});

describe("groupmePlugin status and gateway", () => {
  it("builds status summaries and account snapshots with null/default fallbacks", () => {
    expect(groupmePlugin.status.buildChannelSummary({ snapshot: {} })).toEqual({
      configured: false,
      running: false,
      webhookPath: null,
      lastStartAt: null,
      lastStopAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
    });

    const snapshot = groupmePlugin.status.buildAccountSnapshot({
      account: account(),
      runtime: {
        running: true,
        lastStartAt: 1,
        lastStopAt: 2,
        lastInboundAt: 3,
        lastOutboundAt: 4,
        lastError: "oops",
      },
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        botId: "***",
        tokenSource: "configured",
        webhookPath: "/groupme/custom",
        running: true,
        mode: "webhook",
      }),
    );
  });

  it("marks secret input objects as configured in account snapshots", () => {
    const snapshot = groupmePlugin.status.buildAccountSnapshot({
      account: account({
        botId: "",
        accessToken: "",
        config: {
          botId: { source: "env", provider: "default", id: "GROUPME_BOT_ID" },
          accessToken: { source: "env", provider: "default", id: "GROUPME_ACCESS_TOKEN" },
        },
      }),
      runtime: undefined,
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        botId: "***",
        tokenSource: "configured",
      }),
    );
  });

  it("registers a webhook route and unregisters it on abort", async () => {
    const unregister = vi.fn();
    registerPluginHttpRouteMock.mockReturnValueOnce(unregister);
    const abortController = new AbortController();
    const statuses: Array<Record<string, unknown>> = [];
    const info = vi.fn();

    const start = groupmePlugin.gateway.startAccount({
      account: account(),
      cfg: cfg({ botId: "bot-1", groupId: "g1", callbackToken: "secret" }),
      runtime: { log: vi.fn(), error: vi.fn() },
      abortSignal: abortController.signal,
      setStatus: (patch) => statuses.push(patch),
      log: { info },
    });

    await vi.waitFor(() => {
      expect(registerPluginHttpRouteMock).toHaveBeenCalledTimes(1);
    });
    const route = registerPluginHttpRouteMock.mock.calls[0]?.[0];
    expect(route).toEqual(
      expect.objectContaining({
        path: "/groupme/custom",
        fallbackPath: "/groupme",
        auth: "plugin",
        pluginId: "groupme",
        accountId: DEFAULT_ACCOUNT_ID,
      }),
    );
    expect(statuses[0]).toEqual(
      expect.objectContaining({
        running: true,
        webhookPath: "/groupme/custom",
        lastError: null,
      }),
    );

    abortController.abort();
    await start;

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      `[${DEFAULT_ACCOUNT_ID}] GroupMe webhook listening on /groupme/custom`,
    );
  });

  it("unregisters immediately when the abort signal is already aborted", async () => {
    const unregister = vi.fn();
    registerPluginHttpRouteMock.mockReturnValueOnce(unregister);
    const abortController = new AbortController();
    abortController.abort();

    await groupmePlugin.gateway.startAccount({
      account: account({ config: { botId: "bot-1", webhookPath: "relative/path" } }),
      cfg: cfg({ botId: "bot-1", groupId: "g1" }),
      runtime: { log: vi.fn(), error: vi.fn() },
      abortSignal: abortController.signal,
      setStatus: vi.fn(),
      log: { info: vi.fn() },
    });

    expect(registerPluginHttpRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/relative/path" }),
    );
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("refuses to start an unconfigured account", async () => {
    await expect(
      groupmePlugin.gateway.startAccount({
        account: account({ configured: false, botId: "", config: {} }),
        cfg: cfg({}),
        runtime: { log: vi.fn(), error: vi.fn() },
        abortSignal: new AbortController().signal,
        setStatus: vi.fn(),
        log: { info: vi.fn() },
      }),
    ).rejects.toThrow(/not configured/);
  });
});
