import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import type { CoreConfig, ResolvedGroupMeAccount } from "./types.js";

const handleGroupMeInboundMock = vi.hoisted(() =>
  vi.fn(async (_params: unknown) => undefined),
);

vi.mock("./inbound.js", () => ({
  handleGroupMeInbound: handleGroupMeInboundMock,
}));

import { createGroupMeWebhookHandler } from "./monitor.js";

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

function isListenPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeErr = error as { code?: unknown; syscall?: unknown };
  return maybeErr.code === "EPERM" && maybeErr.syscall === "listen";
}

async function runIfServerAllowed(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (isListenPermissionError(error)) {
      return;
    }
    throw error;
  }
}

function buildRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: (() => {
      throw new Error("exit");
    }) as RuntimeEnv["exit"],
  };
}

function buildAccount(
  overrides?: Partial<ResolvedGroupMeAccount>,
): ResolvedGroupMeAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    botId: "bot-1",
    accessToken: "token-1",
    config: {
      botId: "bot-1",
      accessToken: "token-1",
      security: {
        callbackAuth: {
          enabled: true,
          token: "secret-token",
          queryKey: "k",
          tokenLocation: "query",
          rejectStatus: 404,
        },
        groupBinding: {
          enabled: true,
          expectedGroupId: "456",
        },
        replay: {
          enabled: true,
          ttlSeconds: 600,
          maxEntries: 1000,
        },
        rateLimit: {
          enabled: true,
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

const config = {} as CoreConfig;

describe("createGroupMeWebhookHandler", () => {
  it("returns 405 for non-POST", async () => {
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/groupme`, { method: "GET" });
        expect(response.status).toBe(405);
        expect(await response.text()).toBe("Method Not Allowed");
      });
    });
  });

  it("rejects webhook without callback token", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await runIfServerAllowed(async () => {
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
  });

  it("returns 400 for invalid JSON after auth", async () => {
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const response = await fetch(webhookUrl(baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        });
        expect(response.status).toBe(400);
      });
    });
  });

  it("acknowledges authenticated payload and dispatches inbound", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await runIfServerAllowed(async () => {
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
  });

  it("drops duplicate replay payloads", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });
    const payload = buildPayload({
      id: "msg-replay",
      source_guid: "guid-replay",
    });

    await runIfServerAllowed(async () => {
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
  });

  it("rejects mismatched group id before dispatch", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({
      account: buildAccount(),
      config,
      runtime,
    });

    await runIfServerAllowed(async () => {
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
  });

  it("enforces per-sender rate limit", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          rateLimit: {
            enabled: true,
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

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const first = await fetch(webhookUrl(baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            buildPayload({ id: "rate-1", source_guid: "rate-guid-1" }),
          ),
        });
        const second = await fetch(webhookUrl(baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            buildPayload({ id: "rate-2", source_guid: "rate-guid-2" }),
          ),
        });
        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
      });
    });
  });

  it("accepts trusted forwarded host/proto when proxy security is enabled", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          proxy: {
            enabled: true,
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

    await runIfServerAllowed(async () => {
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
  });

  it("rejects disallowed forwarded host when proxy policy is enabled", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          proxy: {
            enabled: true,
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

    await runIfServerAllowed(async () => {
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
  });

  it("ignores forwarded client ip when request is not from trusted proxy", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const account = buildAccount({
      config: {
        ...buildAccount().config,
        security: {
          ...buildAccount().config.security,
          proxy: {
            enabled: true,
            trustedProxyCidrs: ["203.0.113.9/32"],
            rejectStatus: 403,
          },
          rateLimit: {
            enabled: true,
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

    await runIfServerAllowed(async () => {
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
});
