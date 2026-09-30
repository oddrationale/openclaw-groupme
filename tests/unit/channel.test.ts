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
const sanitizeText = method(outbound.sanitizeText, "outbound.sanitizeText");
const messageAdapter = requirePluginMember("message");
const security = requirePluginMember("security");
const agentPrompt = requirePluginMember("agentPrompt");
const collectWarnings = method(security.collectWarnings, "security.collectWarnings");
const inspectAccount = method(configAdapter.inspectAccount, "config.inspectAccount");
const sendTextMessage = method(messageAdapter.send?.text, "message.send.text");
const sendMediaMessage = method(messageAdapter.send?.media, "message.send.media");
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
    expect(isConfigured(account())).toBe(true);
    expect(resolveAllowFrom({ cfg: coreCfg, accountId: "work" })).toEqual(["u2"]);
    expect(resolveRequireMention({ cfg: coreCfg, accountId: "work" })).toBe(false);
  });

  it("returns empty allowFrom and default requireMention for a bare account", () => {
    const bare = cfg({ botId: "bot-1" });
    expect(resolveAllowFrom({ cfg: bare, accountId: DEFAULT_ACCOUNT_ID })).toEqual([]);
    expect(resolveRequireMention({ cfg: bare, accountId: DEFAULT_ACCOUNT_ID })).toBe(true);
  });

  it("describes configured accounts without leaking secrets and normalizes webhook paths", () => {
    const described = describeAccount(account());

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
    expect(resolveTarget({}).ok).toBe(false);
  });

  it("chunks and sanitizes outbound text with the SDK helpers, without a runtime", () => {
    expect(outbound.textChunkLimit).toBe(1000);
    expect(outbound.chunkerMode).toBe("markdown");
    expect(outbound.deliveryMode).toBe("direct");
    expect(chunker("aaaa bbbb cccc", 5)).toEqual(["aaaa", "bbbb", "cccc"]);
    expect(sanitizeText({ text: "<think>plan</think>visible", payload: { text: "" } })).toBe(
      "visible",
    );
  });

  it("delegates text and media sends and returns receipts without a platform id", async () => {
    sendGroupMeTextMock.mockResolvedValueOnce({ messageId: "", timestamp: 100 });
    sendGroupMeMediaMock.mockResolvedValueOnce({ messageId: "", timestamp: 200 });
    const coreCfg = cfg({ botId: "bot-1", accessToken: "token-1" });
    const onPlatformSendDispatch = vi.fn(async () => undefined);
    const assertDirectAdapterHandoff = vi.fn();
    const signal = new AbortController().signal;
    const mediaReadFile = vi.fn(async () => Buffer.from(""));

    const textResult = await sendText({
      cfg: coreCfg,
      to: "g1",
      text: "hello",
      accountId: DEFAULT_ACCOUNT_ID,
      onPlatformSendDispatch,
      assertDirectAdapterHandoff,
      signal,
    });
    expect(textResult).toEqual({
      channel: "groupme",
      messageId: "",
      timestamp: 100,
      target: { kind: "chat", id: "g1" },
      receipt: expect.objectContaining({ platformMessageIds: [], parts: [], threadId: "g1" }),
    });

    const mediaResult = await sendMedia({
      cfg: coreCfg,
      to: "g1",
      text: "image",
      mediaUrl: "https://example.com/image.png",
      mediaReadFile,
      accountId: DEFAULT_ACCOUNT_ID,
      onPlatformSendDispatch,
      assertDirectAdapterHandoff,
      signal,
    });
    expect(mediaResult).toEqual(
      expect.objectContaining({ channel: "groupme", messageId: "", timestamp: 200 }),
    );
    expect(mediaResult.receipt.platformMessageIds).toEqual([]);

    expect(sendGroupMeTextMock).toHaveBeenCalledWith({
      cfg: coreCfg,
      to: "g1",
      text: "hello",
      accountId: DEFAULT_ACCOUNT_ID,
      onPlatformSendDispatch,
      assertDirectAdapterHandoff,
      signal,
      confirmMessageId: true,
    });
    expect(sendGroupMeMediaMock).toHaveBeenCalledWith({
      cfg: coreCfg,
      to: "g1",
      text: "image",
      mediaUrl: "https://example.com/image.png",
      mediaReadFile,
      accountId: DEFAULT_ACCOUNT_ID,
      onPlatformSendDispatch,
      assertDirectAdapterHandoff,
      signal,
      confirmMessageId: true,
    });
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

  it("reports the confirmed GroupMe message id in the receipt", async () => {
    sendGroupMeTextMock.mockResolvedValueOnce({
      messageId: "179000000000000001",
      timestamp: 100,
    });
    const result = await sendText({
      cfg: cfg({ botId: "bot-1", accessToken: "token-1" }),
      to: "g1",
      text: "hello",
      accountId: DEFAULT_ACCOUNT_ID,
    });
    expect(result.messageId).toBe("179000000000000001");
    expect(result.receipt).toEqual(
      expect.objectContaining({
        primaryPlatformMessageId: "179000000000000001",
        platformMessageIds: ["179000000000000001"],
      }),
    );
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

  it("treats a non-positive peer limit as unlimited", async () => {
    const peers = await listPeers({
      cfg: cfg({ botId: "bot-1", allowFrom: ["u1", "u2"] }),
      accountId: DEFAULT_ACCOUNT_ID,
      limit: 0,
      runtime: buildRuntimeEnv(),
    });
    const negative = await listPeers({
      cfg: cfg({ botId: "bot-1", allowFrom: ["u1", "u2"] }),
      accountId: DEFAULT_ACCOUNT_ID,
      limit: -1,
      runtime: buildRuntimeEnv(),
    });

    expect(peers).toHaveLength(2);
    expect(negative).toHaveLength(2);
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
    await expect(self()).resolves.toBeNull();
    await expect(listGroups()).resolves.toEqual([]);
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

  it("fills missing runtime activity fields with null in account snapshots", () => {
    const snapshot = buildAccountSnapshot({
      account: account({ config: {} }),
      cfg: cfg({}),
      runtime: { accountId: DEFAULT_ACCOUNT_ID },
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        botId: "",
        tokenSource: "none",
        webhookPath: "/groupme",
        running: false,
        lastStartAt: null,
        lastStopAt: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastError: null,
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

  it("parks an unconfigured account as blocked until the gateway aborts it", async () => {
    const abortController = new AbortController();
    const setStatus = vi.fn();
    const warn = vi.fn();
    let settled = false;

    const start = startAccount({
      account: account({ configured: false, botId: "", config: {} }),
      accountId: DEFAULT_ACCOUNT_ID,
      cfg: cfg({}),
      runtime: buildRuntimeEnv(),
      abortSignal: abortController.signal,
      getStatus: () => ({ accountId: DEFAULT_ACCOUNT_ID }),
      setStatus,
      log: { info: vi.fn(), warn, error: vi.fn() },
    }).then(() => {
      settled = true;
    });

    expect(setStatus).toHaveBeenCalledWith({
      lifecycle: "blocked",
      terminalDisconnect: true,
      lastError: 'GroupMe is not configured for account "default" (missing botId).',
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
    });
    expect(warn).toHaveBeenCalledWith(
      "[default] GroupMe is not configured (missing botId); webhook not registered",
    );
    expect(registerPluginHttpRouteMock).not.toHaveBeenCalled();

    // Resolving early would make the gateway restart the account in a loop.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    abortController.abort();
    await start;
    expect(settled).toBe(true);
    expect(setStatus).toHaveBeenCalledTimes(1);
  });

  it("reports ready and stopped lifecycle patches around the webhook route", async () => {
    const unregister = vi.fn();
    registerPluginHttpRouteMock.mockReturnValueOnce(unregister);
    const abortController = new AbortController();
    const setStatus = vi.fn();

    const start = startAccount({
      account: account(),
      accountId: DEFAULT_ACCOUNT_ID,
      cfg: cfg({ botId: "bot-1", groupId: "g1" }),
      runtime: buildRuntimeEnv(),
      abortSignal: abortController.signal,
      getStatus: () => ({ accountId: DEFAULT_ACCOUNT_ID }),
      setStatus,
    });

    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith({
      running: true,
      connected: true,
      lifecycle: "ready",
      lastConnectedAt: expect.any(Number),
      lastError: null,
      terminalDisconnect: undefined,
      accountId: DEFAULT_ACCOUNT_ID,
      mode: "webhook",
      webhookPath: "/groupme/custom",
      lastStartAt: expect.any(Number),
    });
    expect(unregister).not.toHaveBeenCalled();

    abortController.abort();
    await start;

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith({
      running: false,
      connected: false,
      lifecycle: "stopped",
      accountId: DEFAULT_ACCOUNT_ID,
      lastStopAt: expect.any(Number),
    });
  });

  it("builds the handler and route log without a gateway logger", async () => {
    registerPluginHttpRouteMock.mockReturnValueOnce(vi.fn());
    const abortController = new AbortController();
    abortController.abort();

    await startAccount({
      account: account(),
      accountId: DEFAULT_ACCOUNT_ID,
      cfg: cfg({ botId: "bot-1", groupId: "g1" }),
      runtime: buildRuntimeEnv(),
      abortSignal: abortController.signal,
      getStatus: () => ({ accountId: DEFAULT_ACCOUNT_ID }),
      setStatus: vi.fn(),
    });

    const route = registerPluginHttpRouteMock.mock.calls[0]?.[0] as {
      handler: unknown;
      log: (message: string) => void;
    };
    expect(route.handler).toBeTypeOf("function");
    expect(() => route.log("no logger attached")).not.toThrow();
  });

  it("parks an unconfigured account without a gateway logger", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const setStatus = vi.fn();

    await startAccount({
      account: account({ configured: false, botId: "", config: {} }),
      accountId: DEFAULT_ACCOUNT_ID,
      cfg: cfg({}),
      runtime: buildRuntimeEnv(),
      abortSignal: abortController.signal,
      getStatus: () => ({ accountId: DEFAULT_ACCOUNT_ID }),
      setStatus,
    });

    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: "blocked" }));
  });

  it("starts with an idle default runtime state", () => {
    expect(status.defaultRuntime).toEqual({
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    });
  });
});

describe("groupmePlugin message adapter", () => {
  it("declares durable final delivery for text and media", () => {
    expect(messageAdapter.id).toBe("groupme");
    expect(messageAdapter.durableFinal?.capabilities).toEqual({ text: true, media: true });
    expect(messageAdapter.receive).toBeDefined();
  });

  it("sends text and media through the GroupMe helpers with empty receipts", async () => {
    sendGroupMeTextMock.mockResolvedValueOnce({ messageId: "", timestamp: 10 });
    sendGroupMeMediaMock.mockResolvedValueOnce({ messageId: "", timestamp: 20 });
    const coreCfg = cfg({ botId: "bot-1", accessToken: "token-1" });

    const text = await sendTextMessage({
      cfg: coreCfg,
      to: "g1",
      text: "hi",
      accountId: DEFAULT_ACCOUNT_ID,
    });
    const media = await sendMediaMessage({
      cfg: coreCfg,
      to: "g1",
      text: "",
      mediaUrl: "https://example.com/a.png",
      accountId: DEFAULT_ACCOUNT_ID,
    });

    expect(text).toEqual(
      expect.objectContaining({ messageId: "", timestamp: 10, target: { kind: "chat", id: "g1" } }),
    );
    expect(text.receipt).toEqual(
      expect.objectContaining({ platformMessageIds: [], parts: [], threadId: "g1" }),
    );
    expect(media).toEqual(expect.objectContaining({ messageId: "", timestamp: 20 }));
    expect(sendGroupMeMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "g1", mediaUrl: "https://example.com/a.png" }),
    );
  });

  it("rejects media sends without a mediaUrl", async () => {
    await expect(
      sendMediaMessage({
        cfg: cfg({ botId: "bot-1", accessToken: "token-1" }),
        to: "g1",
        text: "",
        mediaUrl: "  ",
        accountId: DEFAULT_ACCOUNT_ID,
      }),
    ).rejects.toThrow("GroupMe media send requires a mediaUrl");
    expect(sendGroupMeMediaMock).not.toHaveBeenCalled();
  });
});

describe("groupmePlugin messaging, prompt, and security surfaces", () => {
  it("infers group chats for GroupMe targets and exposes the target prefix", () => {
    expect(messaging.targetPrefixes).toEqual(["groupme"]);
    const infer = method(messaging.inferTargetChatType, "messaging.inferTargetChatType");
    expect(infer({ to: "groupme:group:123" })).toBe("group");
    expect(infer({ to: "12345" })).toBe("group");
    expect(infer({ to: "" })).toBeUndefined();
  });

  it("tells the agent GroupMe renders plain text only", () => {
    const hints = method(agentPrompt.inboundFormattingHints, "agentPrompt.inboundFormattingHints");
    const result = hints();
    expect(result?.text_markup).toBe("plain");
    expect(result?.rules.join("\n")).toContain("under 1000 characters");
  });

  it("collects no warnings for a fully secured account", () => {
    expect(
      collectWarnings({
        cfg: cfg({}),
        accountId: DEFAULT_ACCOUNT_ID,
        account: account({ config: { ...account().config, groupId: "g1" } }),
      }),
    ).toEqual([]);
  });

  it("warns about missing callback token, group id, access token, and open commands", () => {
    const warnings = collectWarnings({
      cfg: cfg({}),
      accountId: DEFAULT_ACCOUNT_ID,
      account: account({
        accessToken: "",
        config: {
          botId: "bot-1",
          security: { commandBypass: { requireAllowFrom: false } },
        },
      }),
    });

    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toMatch(/callbackToken is not configured/);
    expect(warnings[1]).toMatch(/groupId is not configured/);
    expect(warnings[2]).toMatch(/accessToken is not configured/);
    expect(warnings[3]).toMatch(/requireAllowFrom=false/);
  });

  it("inspects account credentials without exposing their values", () => {
    const inspected = inspectAccount(
      cfg({
        botId: "bot-1",
        accessToken: { source: "env", provider: "default", id: "GROUPME_ACCESS_TOKEN" },
      }),
      DEFAULT_ACCOUNT_ID,
    );
    expect(inspected).toEqual(
      expect.objectContaining({
        accountId: DEFAULT_ACCOUNT_ID,
        enabled: true,
        configured: true,
        botIdStatus: "available",
        accessTokenStatus: "available",
        callbackTokenStatus: "missing",
      }),
    );

    expect(
      inspectAccount(cfg({ botId: "bot-1", callbackToken: "cb" }), DEFAULT_ACCOUNT_ID),
    ).toEqual(expect.objectContaining({ callbackTokenStatus: "available" }));

    expect(inspectAccount(cfg({}), DEFAULT_ACCOUNT_ID)).toEqual(
      expect.objectContaining({
        configured: false,
        botIdStatus: "missing",
        accessTokenStatus: "missing",
      }),
    );
  });

  // Core's security audit passes the `config.inspectAccount` result as `account`
  // to `security.collectWarnings` (audit-channel: resolvedAccount =
  // inspectAccount(cfg, id)), so the inspect result must carry the account fields.
  it("produces warnings from the account core's audit inspects", () => {
    const coreCfg = cfg({ botId: "bot-1", groupId: "g1" });
    // Core hands the inspect result over untyped; mirror that here.
    const inspected = inspectAccount(
      coreCfg,
      DEFAULT_ACCOUNT_ID,
    ) as unknown as ResolvedGroupMeAccount;

    const warnings = collectWarnings({
      cfg: coreCfg,
      accountId: DEFAULT_ACCOUNT_ID,
      account: inspected,
    });

    expect(warnings).toEqual([
      expect.stringMatching(/callbackToken is not configured/),
      expect.stringMatching(/accessToken is not configured/),
    ]);
  });
});
