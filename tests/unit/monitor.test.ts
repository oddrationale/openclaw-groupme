import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { CoreConfig, ResolvedGroupMeAccount } from "../../src/types.js";
import { buildRuntimeEnv } from "./helpers/inbound.js";

const handleGroupMeInboundMock = vi.hoisted(() => vi.fn(async (_params: unknown) => undefined));

vi.mock("../../src/inbound.js", () => ({
  handleGroupMeInbound: handleGroupMeInboundMock,
}));

import { createGroupMeWebhookHandler } from "../../src/monitor.js";

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  fn: (baseUrl: string) => Promise<void>,
) {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("missing server address");
  }

  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Probe once whether this environment can bind a loopback TCP server. Some
 * sandboxes block `listen`; rather than silently passing the HTTP-boundary tests
 * (which would assert nothing), we skip them *visibly* via `itHttp` so the test
 * report shows them as skipped instead of green.
 */
async function probeCanBind(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.close(() => resolve());
      });
    });
    return true;
  } catch {
    return false;
  }
}

const canBindLoopback = await probeCanBind();
const itHttp = canBindLoopback ? it : it.skip;

function buildAccount(overrides?: Partial<ResolvedGroupMeAccount>): ResolvedGroupMeAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    botId: "bot-1",
    accessToken: "token-1",
    config: {
      botId: "bot-1",
      accessToken: "token-1",
      groupId: "456",
      webhookPath: "/groupme",
      callbackToken: "secret-token",
      security: {
        replay: {
          ttlSeconds: 600,
          maxEntries: 1000,
        },
        rateLimit: {
          windowMs: 60_000,
          maxRequestsPerIp: 120,
          maxRequestsPerSender: 60,
          maxConcurrent: 8,
        },
      },
    },
    ...overrides,
  };
}

function buildPayload(overrides?: Record<string, unknown>) {
  return {
    id: "msg-1",
    text: "hello",
    name: "Alice",
    sender_type: "user",
    sender_id: "123",
    user_id: "123",
    group_id: "456",
    source_guid: "source",
    created_at: 1_700_000_000,
    system: false,
    attachments: [],
    ...overrides,
  };
}

function webhookUrl(baseUrl: string, token = "secret-token"): string {
  return `${baseUrl}/groupme?k=${token}`;
}

function mockRequest(params: { url: string; body: string; method?: string }): IncomingMessage {
  const stream = Readable.from([Buffer.from(params.body)]) as unknown as IncomingMessage;
  stream.method = params.method ?? "POST";
  stream.url = params.url;
  stream.headers = { "content-type": "application/json" };
  (stream as { socket: unknown }).socket = { remoteAddress: "127.0.0.1", encrypted: false };
  return stream;
}

type MockResponse = ServerResponse & { body: string };

function mockResponse(): MockResponse {
  const res = {
    statusCode: 0,
    body: "",
    setHeader() {},
    end(chunk?: string) {
      if (chunk) res.body += chunk;
    },
  };
  return res as unknown as MockResponse;
}

const config = {} as CoreConfig;

describe("createGroupMeWebhookHandler", () => {
  it("logs a warning when no groupId is configured", () => {
    const runtime = buildRuntimeEnv();
    createGroupMeWebhookHandler({
      account: buildAccount({
        config: {
          ...buildAccount().config,
          groupId: "",
        },
      }),
      config,
      runtime,
    });

    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("no groupId configured"));
  });

  it("does not log rejected requests when logging is disabled", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const base = buildAccount().config;
    const handler = createGroupMeWebhookHandler({
      account: buildAccount({
        config: {
          ...base,
          security: { ...base.security, logging: { logRejectedRequests: false } },
        },
      }),
      config,
      runtime,
    });

    const req = mockRequest({
      url: "/groupme?k=secret-token",
      body: JSON.stringify(buildPayload({ group_id: "wrong-group" })),
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(runtime.error).not.toHaveBeenCalled();
    expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
  });

  it("logs a warning when no callbackToken is configured", () => {
    const runtime = buildRuntimeEnv();
    createGroupMeWebhookHandler({
      account: buildAccount({
        config: {
          ...buildAccount().config,
          callbackToken: "",
        },
      }),
      config,
      runtime,
    });

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("no callbackToken configured"),
    );
    expect(runtime.error).not.toHaveBeenCalledWith(
      expect.stringContaining("no groupId configured"),
    );
  });

  itHttp("returns 405 for non-POST", async () => {
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/groupme`, { method: "GET" });
      expect(response.status).toBe(405);
      expect(await response.text()).toBe("Method Not Allowed");
    });
  });

  itHttp("rejects webhook without callback token", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/groupme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      expect(response.status).toBe(404);
      expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
    });
  });

  itHttp("returns 400 for invalid JSON after auth", async () => {
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(response.status).toBe(400);
    });
  });

  it("returns 413 when the request body exceeds the size limit", async () => {
    // Driven directly against the handler (no socket): responding 413 mid-upload
    // over a real connection races into ECONNRESET, which would be flaky.
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    const oversized = JSON.stringify({ ...buildPayload(), text: "x".repeat(70 * 1024) });
    const req = mockRequest({ url: "/groupme?k=secret-token", body: oversized });
    const res = mockResponse();
    await handler(req, res);

    expect(res.statusCode).toBe(413);
    expect(res.body.length).toBeGreaterThan(0);
    expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
  });

  itHttp("returns 400 for structurally invalid callback payloads", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nope: true }),
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Bad Request");
      expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
    });
  });

  itHttp("acks ignored GroupMe bot, system, and empty callbacks without dispatching", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      for (const payload of [
        buildPayload({ id: "bot-msg", source_guid: "bot-guid", sender_type: "bot" }),
        buildPayload({ id: "system-msg", source_guid: "system-guid", system: true }),
        buildPayload({ id: "empty-msg", source_guid: "empty-guid", text: "  " }),
      ]) {
        const response = await fetch(webhookUrl(baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
      }
      expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
    });
  });

  itHttp("acknowledges authenticated payload and dispatches inbound", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(handleGroupMeInboundMock).toHaveBeenCalledTimes(1);
      const call = handleGroupMeInboundMock.mock.calls[0]?.[0] as
        | { historyLimit?: unknown; groupHistories?: unknown }
        | undefined;
      expect(call?.historyLimit).toBe(20);
      expect(call?.groupHistories).toBeInstanceOf(Map);
    });
  });

  itHttp("logs asynchronous inbound processing failures after acknowledging", async () => {
    handleGroupMeInboundMock.mockClear();
    handleGroupMeInboundMock.mockRejectedValueOnce(new Error("agent failed"));
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      expect(response.status).toBe(200);
      await vi.waitFor(() => {
        expect(runtime.error).toHaveBeenCalledWith(
          expect.stringContaining("inbound processing failed"),
        );
      });
    });
  });

  itHttp("drops duplicate replay payloads", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });
    const payload = buildPayload({
      id: "msg-replay",
      source_guid: "guid-replay",
    });

    await withServer(handler, async (baseUrl) => {
      const first = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const second = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(handleGroupMeInboundMock).toHaveBeenCalledTimes(1);
    });
  });

  itHttp("rejects mismatched group id before dispatch", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload({ group_id: "wrong-group" })),
      });
      expect(response.status).toBe(403);
      expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
    });
  });

  itHttp("enforces per-sender rate limit", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          rateLimit: {
            windowMs: 60_000,
            maxRequestsPerIp: 120,
            maxRequestsPerSender: 1,
            maxConcurrent: 8,
          },
        },
      },
    });
    const handler = createGroupMeWebhookHandler({
      account,
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const first = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload({ id: "rate-1", source_guid: "rate-guid-1" })),
      });
      const second = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload({ id: "rate-2", source_guid: "rate-guid-2" })),
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    });
  });

  itHttp("accepts trusted forwarded host/proto when proxy security is enabled", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          proxy: {
            trustedProxyCidrs: ["127.0.0.1/32"],
            allowedPublicHosts: ["bot.example.com"],
            requireHttpsProto: true,
            rejectStatus: 403,
          },
        },
      },
    });
    const handler = createGroupMeWebhookHandler({
      account,
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "internal.gateway.local",
          "x-forwarded-host": "bot.example.com",
          "x-forwarded-proto": "https",
          "x-forwarded-for": "198.51.100.55",
        },
        body: JSON.stringify(buildPayload()),
      });
      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(handleGroupMeInboundMock).toHaveBeenCalledTimes(1);
    });
  });

  itHttp("rejects disallowed forwarded host when proxy policy is enabled", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          proxy: {
            trustedProxyCidrs: ["127.0.0.1/32"],
            allowedPublicHosts: ["bot.example.com"],
            rejectStatus: 403,
          },
        },
      },
    });
    const handler = createGroupMeWebhookHandler({
      account,
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "internal.gateway.local",
          "x-forwarded-host": "attacker.example",
        },
        body: JSON.stringify(buildPayload()),
      });
      expect(response.status).toBe(403);
      expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
    });
  });

  itHttp("ignores forwarded client ip when request is not from trusted proxy", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntimeEnv();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          proxy: {
            trustedProxyCidrs: ["203.0.113.9/32"],
            rejectStatus: 403,
          },
          rateLimit: {
            windowMs: 60_000,
            maxRequestsPerIp: 1,
            maxRequestsPerSender: 20,
            maxConcurrent: 8,
          },
        },
      },
    });
    const handler = createGroupMeWebhookHandler({
      account,
      config,
      runtime,
    });

    await withServer(handler, async (baseUrl) => {
      const first = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.1",
        },
        body: JSON.stringify(
          buildPayload({ id: "proxy-rate-1", source_guid: "proxy-rate-guid-1" }),
        ),
      });
      const second = await fetch(webhookUrl(baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.2",
        },
        body: JSON.stringify(
          buildPayload({ id: "proxy-rate-2", source_guid: "proxy-rate-guid-2" }),
        ),
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    });
  });
});
