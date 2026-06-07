import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGroupMeRuntime } from "../../src/runtime.js";
import type { CoreConfig, GroupMeConfig, ResolvedGroupMeAccount } from "../../src/types.js";
import { buildRuntimeEnv } from "./helpers/inbound.js";

const registerPluginHttpRouteMock = vi.hoisted(() => vi.fn());
const sendGroupMeTextMock = vi.hoisted(() => vi.fn());
const sendGroupMeMediaMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/webhook-ingress", () => ({
  registerPluginHttpRoute: registerPluginHttpRouteMock,
}));

vi.mock("../../src/send.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/send.js")>();
  return {
    ...actual,
    sendGroupMeText: sendGroupMeTextMock,
    sendGroupMeMedia: sendGroupMeMediaMock,
  };
});

import { groupmePlugin } from "../../src/channel.js";

// The ChannelPlugin surface marks most capability groups and their methods
// optional (plugins implement subsets). Assert the GroupMe-implemented ones are
// present once, up front, so every per-test call below stays fully type-checked.
function requirePluginMember<K extends keyof typeof groupmePlugin>(
  key: K,
): NonNullable<(typeof groupmePlugin)[K]> {
  const value = groupmePlugin[key];
  if (!value) {
    throw new Error(`expected groupmePlugin.${String(key)} to be defined`);
  }
  return value as NonNullable<(typeof groupmePlugin)[K]>;
}

function method<T>(value: T, label: string): NonNullable<T> {
  if (value == null) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value as NonNullable<T>;
}

const configAdapter = requirePluginMember("config");
const groups = requirePluginMember("groups");
const outbound = requirePluginMember("outbound");
const resolver = requirePluginMember("resolver");
const messaging = requirePluginMember("messaging");
const directory = requirePluginMember("directory");
const status = requirePluginMember("status");
const gateway = requirePluginMember("gateway");

const listAccountIds = configAdapter.listAccountIds;
const resolveAccount = configAdapter.resolveAccount;
const defaultAccountId = method(configAdapter.defaultAccountId, "config.defaultAccountId");
const isConfigured = method(configAdapter.isConfigured, "config.isConfigured");
const resolveAllowFrom = method(configAdapter.resolveAllowFrom, "config.resolveAllowFrom");
const describeAccount = method(configAdapter.describeAccount, "config.describeAccount");
const formatAllowFrom = method(configAdapter.formatAllowFrom, "config.formatAllowFrom");
const setAccountEnabled = method(configAdapter.setAccountEnabled, "config.setAccountEnabled");
const deleteAccount = method(configAdapter.deleteAccount, "config.deleteAccount");
const resolveRequireMention = method(groups.resolveRequireMention, "groups.resolveRequireMention");
const resolveTarget = method(outbound.resolveTarget, "outbound.resolveTarget");
const chunker = method(outbound.chunker, "outbound.chunker");
const sendText = method(outbound.sendText, "outbound.sendText");
const sendMedia = method(outbound.sendMedia, "outbound.sendMedia");
const resolveTargets = method(resolver.resolveTargets, "resolver.resolveTargets");
const normalizeTarget = method(messaging.normalizeTarget, "messaging.normalizeTarget");
const targetResolver = method(messaging.targetResolver, "messaging.targetResolver");
const listPeers = method(directory.listPeers, "directory.listPeers");
const self = method(directory.self, "directory.self");
const listGroups = method(directory.listGroups, "directory.listGroups");
const buildChannelSummary = method(status.buildChannelSummary, "status.buildChannelSummary");
const buildAccountSnapshot = method(status.buildAccountSnapshot, "status.buildAccountSnapshot");
const startAccount = method(gateway.startAccount, "gateway.startAccount");

function cfg(groupme: GroupMeConfig): CoreConfig {
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

    expect(listAccountIds(coreCfg)).toEqual(["default", "work"]);
    expect(defaultAccountId(coreCfg)).toBe("work");
    expect(resolveAccount(coreCfg, "work")).toEqual(
      expect.objectContaining({
        accountId: "work",
        botId: "work-bot",
        configured: true,
      }),
    );
    expect(isConfigured(account(), coreCfg)).toBe(true);
    expect(resolveAllowFrom({ cfg: coreCfg, accountId: "work" })).toEqual(["u2"]);
    expect(resolveRequireMention({ cfg: coreCfg, accountId: "work" })).toBe(false);
  });

  it("returns empty allowFrom and default requireMention for a bare account", () => {
    const bare = cfg({ botId: "bot-1" });
    expect(resolveAllowFrom({ cfg: bare, accountId: DEFAULT_ACCOUNT_ID })).toEqual([]);
    expect(resolveRequireMention({ cfg: bare, accountId: DEFAULT_ACCOUNT_ID })).toBe(true);
  });

  it("describes configured accounts without leaking secrets and normalizes webhook paths", () => {
    const described = describeAccount(account(), cfg({}));

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
    const described = describeAccount(
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
      cfg({}),
    ) as Record<string, unknown>;

    expect(described.botId).toBe("***");
    expect(described.callbackToken).toBe("***");
  });

  it("uses safe defaults when optional account fields are missing", () => {
    const described = describeAccount(
      account({
        name: undefined,
        enabled: false,
        configured: false,
        botId: "",
        config: {},
      }),
      cfg({}),
    ) as Record<string, unknown>;

    expect(described.name).toBeUndefined();
    expect(described.enabled).toBe(false);
    expect(described.configured).toBe(false);
    expect(described.botId).toBe("");
    expect(described.webhookPath).toBe("/groupme");
    expect(described.callbackToken).toBe("");
  });

  it("falls back when webhookPath cannot be parsed as a URL", () => {
    const described = describeAccount(
      account({
        config: {
          webhookPath: "http://%",
        },
      }),
      cfg({}),
    ) as Record<string, unknown>;

    expect(described.webhookPath).toBe("/http://%");
  });

  it("formats allowFrom entries and filters invalid values", () => {
    const formatted = formatAllowFrom({
      cfg: cfg({}),
      allowFrom: ["u1", " groupme:user:u2 ", "", "groupme:group:g1"],
    });

    expect(formatted).toEqual(["u1", "u2", "g1"]);
  });

  it("lists configured peers from allowFrom with query and limit applied", async () => {
    const peers = await listPeers({
      cfg: cfg({
        botId: "bot-1",
        allowFrom: ["u1", "*", "work-user", "home-user"],
      }),
      accountId: DEFAULT_ACCOUNT_ID,
      query: "user",
      limit: 1,
      runtime: buildRuntimeEnv(),
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

    const disabled = setAccountEnabled({
      cfg: base,
      accountId: "work",
      enabled: false,
    }) as CoreConfig;
    expect(disabled.channels?.groupme?.accounts?.work?.enabled).toBe(false);

    const deleted = deleteAccount({
      cfg: disabled,
      accountId: DEFAULT_ACCOUNT_ID,
    }) as CoreConfig;
    expect(deleted.channels?.groupme?.botId).toBeUndefined();
    expect(deleted.channels?.groupme?.callbackToken).toBeUndefined();
    expect(deleted.channels?.groupme?.accounts?.work?.botId).toBe("work-bot");
  });
});

describe("groupmePlugin outbound and resolver", () => {
  it("normalizes valid outbound targets and reports a helpful error for empty targets", () => {
    expect(resolveTarget({ to: " groupme:group:g1 " })).toEqual({
      ok: true,
      to: "g1",
    });

    const missing = resolveTarget({ to: " " });
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

    expect(chunker("hello", 5)).toEqual(["one", "two"]);
    expect(chunkMarkdownText).toHaveBeenCalledWith("hello", 5);
  });

  it("delegates text and media sends to the GroupMe send helpers", async () => {
    sendGroupMeTextMock.mockResolvedValueOnce({ messageId: "m1", timestamp: 100 });
    sendGroupMeMediaMock.mockResolvedValueOnce({ messageId: "m2", timestamp: 200 });
    const coreCfg = cfg({ botId: "bot-1", accessToken: "token-1" });

    await expect(
      sendText({
        cfg: coreCfg,
        to: "groupme:group:g1",
        text: "hello",
        accountId: DEFAULT_ACCOUNT_ID,
      }),
    ).resolves.toEqual({ channel: "groupme", messageId: "m1", timestamp: 100 });

    await expect(
      sendMedia({
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
      sendMedia({
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
    const resolved = await resolveTargets({
      cfg: cfg({ botId: "bot-1" }),
      runtime: buildRuntimeEnv(),
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

  it("omits the group-only note when resolving group targets", async () => {
    const resolved = await resolveTargets({
      cfg: cfg({ botId: "bot-1" }),
      runtime: buildRuntimeEnv(),
      inputs: ["g1"],
      kind: "group",
    });

    expect(resolved[0]).toEqual({
      input: "g1",
      resolved: true,
      id: "g1",
      name: "g1",
      note: undefined,
    });
  });

  it("lists every configured peer when no query or limit is supplied", async () => {
    const peers = await listPeers({
      cfg: cfg({ botId: "bot-1", allowFrom: ["u1", "u2"] }),
      accountId: DEFAULT_ACCOUNT_ID,
      runtime: buildRuntimeEnv(),
    });

    expect(peers).toEqual([
      { kind: "user", id: "u1" },
      { kind: "user", id: "u2" },
    ]);
  });

  it("exposes target normalization helpers and directory defaults", async () => {
    expect(normalizeTarget("groupme:group:g1")).toBe("g1");
    expect(targetResolver.looksLikeId?.("groupme:group:g1")).toBe(true);
    expect(targetResolver.hint).toBe("<group-id>");
    await expect(
      self({ cfg: cfg({}), accountId: DEFAULT_ACCOUNT_ID, runtime: buildRuntimeEnv() }),
    ).resolves.toBeNull();
    await expect(
      listGroups({ cfg: cfg({}), accountId: DEFAULT_ACCOUNT_ID, runtime: buildRuntimeEnv() }),
    ).resolves.toEqual([]);
  });
});

describe("groupmePlugin status and gateway", () => {
  it("builds status summaries and account snapshots with null/default fallbacks", () => {
    expect(
      buildChannelSummary({
        account: account(),
        cfg: cfg({}),
        defaultAccountId: DEFAULT_ACCOUNT_ID,
        snapshot: { accountId: DEFAULT_ACCOUNT_ID },
      }),
    ).toEqual({
      configured: false,
      running: false,
      webhookPath: null,
      lastStartAt: null,
      lastStopAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
    });

    const snapshot = buildAccountSnapshot({
      account: account(),
      cfg: cfg({}),
      runtime: {
        accountId: DEFAULT_ACCOUNT_ID,
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

  it("marks secret input objects as configured in account snapshots", async () => {
    const snapshot = await buildAccountSnapshot({
      account: account({
        botId: "",
        accessToken: "",
        config: {
          botId: { source: "env", provider: "default", id: "GROUPME_BOT_ID" },
          accessToken: { source: "env", provider: "default", id: "GROUPME_ACCESS_TOKEN" },
        },
      }),
      cfg: cfg({}),
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

    const start = startAccount({
      account: account(),
      accountId: DEFAULT_ACCOUNT_ID,
      cfg: cfg({ botId: "bot-1", groupId: "g1", callbackToken: "secret" }),
      runtime: buildRuntimeEnv(),
      abortSignal: abortController.signal,
      getStatus: () => ({ accountId: DEFAULT_ACCOUNT_ID }),
      setStatus: (patch) => {
        statuses.push(patch as Record<string, unknown>);
      },
      log: { info, warn: vi.fn(), error: vi.fn() },
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

    // The route's log adapter forwards to ctx.log.info.
    (route as { log?: (message: string) => void }).log?.("route log ping");
    expect(info).toHaveBeenCalledWith("route log ping");

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

    await startAccount({
      account: account({ config: { botId: "bot-1", webhookPath: "relative/path" } }),
      accountId: DEFAULT_ACCOUNT_ID,
      cfg: cfg({ botId: "bot-1", groupId: "g1" }),
      runtime: buildRuntimeEnv(),
      abortSignal: abortController.signal,
      getStatus: () => ({ accountId: DEFAULT_ACCOUNT_ID }),
      setStatus: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(registerPluginHttpRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/relative/path" }),
    );
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("refuses to start an unconfigured account", async () => {
    await expect(
      startAccount({
        account: account({ configured: false, botId: "", config: {} }),
        accountId: DEFAULT_ACCOUNT_ID,
        cfg: cfg({}),
        runtime: buildRuntimeEnv(),
        abortSignal: new AbortController().signal,
        getStatus: () => ({ accountId: DEFAULT_ACCOUNT_ID }),
        setStatus: vi.fn(),
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ).rejects.toThrow(/not configured/);
  });
});
