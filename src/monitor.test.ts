import type { AddressInfo } from "node:net";
import type { RuntimeEnv } from "openclaw/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
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

const account: ResolvedGroupMeAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  botId: "bot-1",
  accessToken: "token-1",
  config: {
    botId: "bot-1",
    accessToken: "token-1",
  },
};

const config = {} as CoreConfig;

describe("createGroupMeWebhookHandler", () => {
  it("returns 405 for non-POST", async () => {
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({ account, config, runtime });

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/groupme`, { method: "GET" });
        expect(response.status).toBe(405);
        expect(await response.text()).toBe("Method Not Allowed");
      });
    });
  });

  it("returns 400 for invalid JSON", async () => {
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({ account, config, runtime });

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/groupme`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        });
        expect(response.status).toBe(400);
      });
    });
  });

  it("acknowledges parseable payload and dispatches inbound", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({ account, config, runtime });

    const payload = {
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
    };

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/groupme`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");

        // Wait for fire-and-forget processing.
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

  it("passes configured historyLimit to inbound handler", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const accountWithHistory: ResolvedGroupMeAccount = {
      ...account,
      config: {
        ...account.config,
        historyLimit: 7,
      },
    };
    const handler = createGroupMeWebhookHandler({
      account: accountWithHistory,
      config,
      runtime,
    });

    const payload = {
      id: "msg-2",
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
    };

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/groupme`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        expect(response.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const call = handleGroupMeInboundMock.mock.calls[0]?.[0] as
          | { historyLimit?: unknown }
          | undefined;
        expect(call?.historyLimit).toBe(7);
      });
    });
  });

  it("drops unparseable payload after returning 200", async () => {
    handleGroupMeInboundMock.mockClear();
    const runtime = buildRuntime();
    const handler = createGroupMeWebhookHandler({ account, config, runtime });

    await runIfServerAllowed(async () => {
      await withServer(handler, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/groupme`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nope: true }),
        });
        expect(response.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(handleGroupMeInboundMock).not.toHaveBeenCalled();
        expect(runtime.log).toHaveBeenCalledWith(
          "groupme: unparseable callback payload",
        );
      });
    });
  });
});
