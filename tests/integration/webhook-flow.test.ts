import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupMeWebhookHandler } from "../../src/monitor.js";
import { setGroupMeRuntime } from "../../src/runtime.js";
import type { CoreConfig, ResolvedGroupMeAccount } from "../../src/types.js";
import { type NodeHandlerServer, startNodeHandlerServer } from "./helpers/http.js";

type FakeCore = PluginRuntime & {
  fns: {
    activityRecord: ReturnType<typeof vi.fn>;
    resolveAgentRoute: ReturnType<typeof vi.fn>;
    recordInboundSession: ReturnType<typeof vi.fn>;
    dispatchReplyWithBufferedBlockDispatcher: ReturnType<typeof vi.fn>;
    finalizeInboundContext: ReturnType<typeof vi.fn>;
  };
};

function buildCore(): FakeCore {
  const fns = {
    activityRecord: vi.fn(),
    resolveAgentRoute: vi.fn(() => ({
      agentId: "agent-main",
      sessionKey: "groupme:group:g1",
      accountId: "default",
    })),
    recordInboundSession: vi.fn(async () => undefined),
    dispatchReplyWithBufferedBlockDispatcher: vi.fn(async () => undefined),
    finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
  };

  return {
    fns,
    channel: {
      activity: { record: fns.activityRecord },
      routing: { resolveAgentRoute: fns.resolveAgentRoute },
      mentions: { buildMentionRegexes: vi.fn(() => []) },
      commands: { shouldHandleTextCommands: vi.fn(() => false) },
      text: {
        hasControlCommand: vi.fn(() => false),
        chunkMarkdownText: vi.fn((text: string) => [text]),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn((params: { body: string }) => `ENV:${params.body}`),
        finalizeInboundContext: fns.finalizeInboundContext,
        dispatchReplyWithBufferedBlockDispatcher: fns.dispatchReplyWithBufferedBlockDispatcher,
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/openclaw-groupme-integration-session"),
        readSessionUpdatedAt: vi.fn(() => undefined),
        recordInboundSession: fns.recordInboundSession,
      },
    },
  } as unknown as FakeCore;
}

function buildRuntimeEnv(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: (() => {
      throw new Error("exit");
    }) as RuntimeEnv["exit"],
  };
}

function buildAccount(overrides: Partial<ResolvedGroupMeAccount> = {}): ResolvedGroupMeAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    botId: "bot-1",
    accessToken: "token-1",
    config: {
      botId: "bot-1",
      accessToken: "token-1",
      callbackToken: "secret-token",
      groupId: "g1",
      webhookPath: "/groupme",
      requireMention: false,
      allowFrom: ["*"],
      security: {
        replay: {
          ttlSeconds: 600,
          maxEntries: 1000,
        },
        rateLimit: {
          windowMs: 60_000,
          maxRequestsPerIp: 20,
          maxRequestsPerSender: 20,
          maxConcurrent: 8,
        },
      },
    },
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    text: "hello openclaw",
    name: "Alice",
    sender_type: "user",
    sender_id: "user-1",
    user_id: "user-1",
    group_id: "g1",
    source_guid: "source-1",
    created_at: 1_700_000_000,
    system: false,
    attachments: [],
    ...overrides,
  };
}

async function postCallback(baseUrl: string, body: unknown, token = "secret-token") {
  return fetch(`${baseUrl}/groupme?k=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GroupMe webhook flow integration", () => {
  let server: NodeHandlerServer | null = null;

  beforeEach(() => {
    setGroupMeRuntime(buildCore());
  });

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  async function mount(
    params: {
      account?: ResolvedGroupMeAccount;
      runtime?: RuntimeEnv;
      statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
    } = {},
  ) {
    const runtime = params.runtime ?? buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: params.account ?? buildAccount(),
      config: {} as CoreConfig,
      runtime,
      statusSink: params.statusSink,
    });
    server = await startNodeHandlerServer(handler);
    return { baseUrl: server.baseUrl, runtime };
  }

  it("rejects non-POST and missing callback token at the HTTP boundary", async () => {
    const { baseUrl } = await mount();

    const getResponse = await fetch(`${baseUrl}/groupme`);
    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("allow")).toBe("POST");

    const missingTokenResponse = await fetch(`${baseUrl}/groupme`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    expect(missingTokenResponse.status).toBe(404);
  });

  it("moves an authenticated callback through inbound session and reply dispatch", async () => {
    const core = buildCore();
    setGroupMeRuntime(core);
    const statusSink = vi.fn();
    const { baseUrl } = await mount({ statusSink });

    const response = await postCallback(baseUrl, payload());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    await vi.waitFor(() => {
      expect(core.fns.recordInboundSession).toHaveBeenCalledTimes(1);
      expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });

    const ctx = core.fns.finalizeInboundContext.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ctx).toEqual(
      expect.objectContaining({
        BodyForAgent: "hello openclaw",
        From: "groupme:user:user-1",
        To: "groupme:group:g1",
        GroupSpace: "g1",
        MessageSid: "msg-1",
      }),
    );
    expect(statusSink).toHaveBeenCalledWith({ lastInboundAt: 1_700_000_000_000 });
  });

  it("acks ignored bot/system/empty callbacks without runtime dispatch", async () => {
    const core = buildCore();
    setGroupMeRuntime(core);
    const { baseUrl } = await mount();

    for (const ignored of [
      payload({ id: "bot-msg", source_guid: "bot-guid", sender_type: "bot" }),
      payload({ id: "system-msg", source_guid: "system-guid", system: true }),
      payload({ id: "empty-msg", source_guid: "empty-guid", text: " " }),
    ]) {
      const response = await postCallback(baseUrl, ignored);
      expect(response.status).toBe(200);
    }

    expect(core.fns.recordInboundSession).not.toHaveBeenCalled();
    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("deduplicates replayed payloads and rejects wrong group ids", async () => {
    const core = buildCore();
    setGroupMeRuntime(core);
    const { baseUrl } = await mount();
    const replay = payload({ id: "replay", source_guid: "replay-guid" });

    expect((await postCallback(baseUrl, replay)).status).toBe(200);
    expect((await postCallback(baseUrl, replay)).status).toBe(200);
    expect((await postCallback(baseUrl, payload({ group_id: "wrong" }))).status).toBe(403);

    await vi.waitFor(() => {
      expect(core.fns.recordInboundSession).toHaveBeenCalledTimes(1);
    });
  });

  it("enforces per-sender rate limiting before inbound dispatch", async () => {
    const core = buildCore();
    setGroupMeRuntime(core);
    const { baseUrl } = await mount({
      account: buildAccount({
        config: {
          ...buildAccount().config,
          security: {
            ...buildAccount().config.security,
            rateLimit: {
              windowMs: 60_000,
              maxRequestsPerIp: 20,
              maxRequestsPerSender: 1,
              maxConcurrent: 8,
            },
          },
        },
      }),
    });

    expect((await postCallback(baseUrl, payload({ id: "rate-1", source_guid: "r1" }))).status).toBe(
      200,
    );
    expect((await postCallback(baseUrl, payload({ id: "rate-2", source_guid: "r2" }))).status).toBe(
      429,
    );

    await vi.waitFor(() => {
      expect(core.fns.recordInboundSession).toHaveBeenCalledTimes(1);
    });
  });
});
