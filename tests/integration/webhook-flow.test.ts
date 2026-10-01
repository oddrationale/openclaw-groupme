import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupMeWebhookHandler } from "../../src/monitor.js";
import { setGroupMeRuntime } from "../../src/runtime.js";
import type { CoreConfig, ResolvedGroupMeAccount } from "../../src/types.js";
import { requestJson, requestUrl } from "../helpers/fetch.js";
import { createInboundCoreMock, deliverThroughCore, lastContext } from "../unit/helpers/inbound.js";
import { type NodeHandlerServer, startNodeHandlerServer } from "./helpers/http.js";

// The fake runtime runs core's real ingress policy and context builder; only the
// agent turn (`channel.inbound.dispatch`) is stubbed.
type FakeCore = ReturnType<typeof createInboundCoreMock>;

function buildCore(): FakeCore {
  const core = createInboundCoreMock();
  core.fns.resolveAgentRoute.mockReturnValue({
    agentId: "agent-main",
    sessionKey: "agent:agent-main:groupme:group:g1",
    accountId: "default",
  });
  return core;
}

function install(core: FakeCore): FakeCore {
  setGroupMeRuntime(core.runtime as unknown as PluginRuntime);
  return core;
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
    install(buildCore());
  });

  afterEach(async () => {
    await server?.close();
    server = null;
    vi.restoreAllMocks();
  });

  async function mount(
    params: {
      account?: ResolvedGroupMeAccount;
      config?: CoreConfig;
      runtime?: RuntimeEnv;
      statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
    } = {},
  ) {
    const runtime = params.runtime ?? buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: params.account ?? buildAccount(),
      config: params.config ?? ({} as CoreConfig),
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

  it("moves an authenticated callback through ingress, context, and reply dispatch", async () => {
    const core = install(buildCore());
    const statusSink = vi.fn();
    const { baseUrl } = await mount({ statusSink });

    const response = await postCallback(baseUrl, payload());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    await vi.waitFor(() => {
      expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    });

    expect(core.fns.resolveStable).toHaveBeenCalledTimes(1);
    const ctx = lastContext(core);
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
    const core = install(buildCore());
    const { baseUrl } = await mount();

    for (const ignored of [
      payload({ id: "bot-msg", source_guid: "bot-guid", sender_type: "bot" }),
      payload({ id: "system-msg", source_guid: "system-guid", system: true }),
      payload({ id: "empty-msg", source_guid: "empty-guid", text: " " }),
    ]) {
      const response = await postCallback(baseUrl, ignored);
      expect(response.status).toBe(200);
    }

    expect(core.fns.resolveStable).not.toHaveBeenCalled();
    expect(core.fns.dispatch).not.toHaveBeenCalled();
  });

  it("deduplicates replayed payloads and rejects wrong group ids", async () => {
    const core = install(buildCore());
    const { baseUrl } = await mount();
    const replay = payload({ id: "replay", source_guid: "replay-guid" });

    expect((await postCallback(baseUrl, replay)).status).toBe(200);
    expect((await postCallback(baseUrl, replay)).status).toBe(200);
    expect((await postCallback(baseUrl, payload({ group_id: "wrong" }))).status).toBe(403);

    await vi.waitFor(() => {
      expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  it("enforces per-sender rate limiting before inbound dispatch", async () => {
    const core = install(buildCore());
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
      expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  it("delivers the agent reply back through the GroupMe Bot API", async () => {
    const core = install(buildCore());
    const realFetch = globalThis.fetch;
    const botPosts: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (requestUrl(input) === "https://api.groupme.com/v3/bots/post") {
        botPosts.push(requestJson(init));
        return new Response("", { status: 202, statusText: "Accepted" });
      }
      return realFetch(input, init);
    });
    core.fns.dispatch.mockImplementationOnce(async (params) => {
      await deliverThroughCore(params, { text: "<think>plan</think>pong" });
    });
    const statusSink = vi.fn();
    const account = buildAccount();
    // Outbound sends re-resolve the account from the live config, as the gateway does.
    const config = { channels: { groupme: account.config } } as CoreConfig;
    const { baseUrl, runtime } = await mount({ account, config, statusSink });

    expect((await postCallback(baseUrl, payload({ text: "ping" }))).status).toBe(200);

    await vi.waitFor(() => {
      expect(botPosts).toEqual([{ bot_id: "bot-1", text: "pong" }]);
    });
    expect(statusSink).toHaveBeenCalledWith({ lastOutboundAt: expect.any(Number) });
    expect(core.fns.activityRecord).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "groupme", direction: "outbound" }),
    );
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("acks but drops senders outside allowFrom", async () => {
    const core = install(buildCore());
    const { baseUrl, runtime } = await mount({
      account: buildAccount({ config: { ...buildAccount().config, allowFrom: ["someone-else"] } }),
    });

    expect((await postCallback(baseUrl, payload())).status).toBe(200);

    await vi.waitFor(() => {
      expect(runtime.log).toHaveBeenCalledWith("groupme: drop sender user-1 (not in allowFrom)");
    });
    expect(core.fns.dispatch).not.toHaveBeenCalled();
  });

  it("buffers unmentioned chatter and replays it as context on the next mention", async () => {
    const core = install(buildCore());
    const { baseUrl } = await mount({
      account: buildAccount({
        config: { ...buildAccount().config, requireMention: true, botName: "oddclaw" },
      }),
    });

    expect(
      (
        await postCallback(
          baseUrl,
          payload({ id: "chatter", source_guid: "chatter", text: "anyone up for lunch?" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postCallback(
          baseUrl,
          payload({ id: "mention", source_guid: "mention", text: "@oddclaw thoughts?" }),
        )
      ).status,
    ).toBe(200);

    await vi.waitFor(() => {
      expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    });
    const ctx = lastContext(core);
    expect(ctx.MessageSid).toBe("mention");
    expect(ctx.WasMentioned).toBe(true);
    expect(ctx.Body).toContain("Alice: anyone up for lunch?");
    expect(ctx.InboundHistory).toEqual([
      expect.objectContaining({ sender: "Alice", body: "anyone up for lunch?" }),
    ]);
  });
});
