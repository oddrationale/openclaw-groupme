import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplyPayload } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig, ResolvedGroupMeAccount } from "../../src/types.js";
import {
  buildAccount as baseAccount,
  buildMessage,
  buildRuntimeEnv,
  createInboundCoreMock,
  deliverThroughCore,
  lastDispatch,
} from "./helpers/inbound.js";

const core = createInboundCoreMock();
// This suite exercises reply delivery, so make chunking split on the account limit.
core.fns.chunkMarkdownText.mockImplementation((text: string, limit = Number.POSITIVE_INFINITY) =>
  text.length > limit ? [text.slice(0, limit), text.slice(limit)] : [text],
);

const sendGroupMeTextMock = vi.hoisted(() => vi.fn());
const sendGroupMeMediaMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
  tryGetGroupMeRuntime: () => core.runtime,
}));

vi.mock("../../src/send.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/send.js")>();
  return {
    ...actual,
    sendGroupMeText: sendGroupMeTextMock,
    sendGroupMeMedia: sendGroupMeMediaMock,
  };
});

import { handleGroupMeInbound } from "../../src/inbound.js";

const coreCfg = { channels: { groupme: { botId: "bot-1", accessToken: "token-1" } } } as CoreConfig;

function buildAccount(overrides: Partial<ResolvedGroupMeAccount> = {}): ResolvedGroupMeAccount {
  return baseAccount({
    config: { requireMention: false, botName: "oddclaw", textChunkLimit: 5 },
    ...overrides,
  });
}

/** Runs one inbound message, then has "core" deliver `payload` through the adapter. */
async function deliver(payload: ReplyPayload, account = buildAccount()) {
  let delivered: unknown;
  core.fns.dispatch.mockImplementationOnce(async (params) => {
    delivered = await deliverThroughCore(params, payload);
  });
  const statusSink = vi.fn();
  const runtime = buildRuntimeEnv();

  await handleGroupMeInbound({
    message: buildMessage(),
    account,
    config: coreCfg,
    runtime,
    groupHistories: new Map(),
    historyLimit: 0,
    statusSink,
  });

  return { runtime, statusSink, delivered };
}

describe("handleGroupMeInbound reply delivery", () => {
  beforeEach(() => {
    for (const fn of Object.values(core.fns)) {
      fn.mockClear();
    }
    sendGroupMeTextMock.mockReset();
    sendGroupMeMediaMock.mockReset();
    sendGroupMeTextMock.mockResolvedValue({ messageId: "", timestamp: 1 });
    sendGroupMeMediaMock.mockResolvedValue({ messageId: "", timestamp: 2 });
  });

  it("drops empty reply payloads without sending", async () => {
    const { delivered } = await deliver({ text: "  " });

    expect(sendGroupMeTextMock).not.toHaveBeenCalled();
    expect(sendGroupMeMediaMock).not.toHaveBeenCalled();
    expect(delivered).toEqual({ visibleReplySent: false });
  });

  it("reports no visible reply when chunking yields nothing", async () => {
    core.fns.chunkMarkdownText.mockReturnValueOnce([""]);

    const { delivered } = await deliver({ text: "hello" });

    expect(sendGroupMeTextMock).not.toHaveBeenCalled();
    expect(delivered).toEqual({ visibleReplySent: false });
  });

  it("chunks text replies using the account limit and records outbound activity", async () => {
    const { statusSink, delivered } = await deliver({ text: "helloworld" });

    expect(core.fns.chunkMarkdownText).toHaveBeenCalledWith("helloworld", 5);
    expect(sendGroupMeTextMock).toHaveBeenCalledTimes(2);
    expect(sendGroupMeTextMock).toHaveBeenNthCalledWith(1, {
      cfg: coreCfg,
      to: "groupme:group:group-1",
      text: "hello",
      accountId: "default",
    });
    expect(sendGroupMeTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: "world", to: "groupme:group:group-1" }),
    );
    expect(statusSink).toHaveBeenCalledWith(
      expect.objectContaining({ lastOutboundAt: expect.any(Number) }),
    );
    expect(core.fns.activityRecord).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "groupme", direction: "outbound" }),
    );
    expect(delivered).toEqual({ visibleReplySent: true });
  });

  it("sends first media with first text chunk, then remaining chunks and media", async () => {
    const order: string[] = [];
    sendGroupMeTextMock.mockImplementation(async (params: { text: string }) => {
      order.push(`text:${params.text}`);
      return { messageId: "", timestamp: 1 };
    });
    sendGroupMeMediaMock.mockImplementation(async (params: { text: string; mediaUrl: string }) => {
      order.push(`media:${params.mediaUrl}:${params.text}`);
      return { messageId: "", timestamp: 2 };
    });

    const { delivered } = await deliver({
      text: "caption!",
      mediaUrls: ["https://example.com/one.png", "https://example.com/two.png"],
    });

    expect(order).toEqual([
      "media:https://example.com/one.png:capti",
      "text:on!",
      "media:https://example.com/two.png:",
    ]);
    expect(sendGroupMeMediaMock).toHaveBeenNthCalledWith(1, {
      cfg: coreCfg,
      to: "groupme:group:group-1",
      text: "capti",
      mediaUrl: "https://example.com/one.png",
      mediaReadFile: expect.any(Function),
      accountId: "default",
    });
    expect(core.fns.activityRecord).toHaveBeenCalledTimes(4); // inbound + 3 outbound sends
    expect(delivered).toEqual({ visibleReplySent: true });
  });

  it("sends media-only payloads that carry no text field", async () => {
    const { delivered } = await deliver({ mediaUrls: ["https://example.com/a.png"] });

    expect(sendGroupMeMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "", mediaUrl: "https://example.com/a.png" }),
    );
    expect(delivered).toEqual({ visibleReplySent: true });
  });

  it("reads local reply media only from the agent-scoped media roots", async () => {
    const stateDir = process.env.OPENCLAW_STATE_DIR;
    if (!stateDir) {
      throw new Error("expected the vitest setup file to isolate OPENCLAW_STATE_DIR");
    }
    const mediaDir = join(stateDir, "media");
    mkdirSync(mediaDir, { recursive: true });
    const allowed = join(mediaDir, "reply.png");
    writeFileSync(allowed, Buffer.from("png-bytes"));
    const tooBig = join(mediaDir, "big.png");
    writeFileSync(tooBig, Buffer.alloc(64));

    await deliver(
      { mediaUrl: allowed },
      buildAccount({
        config: { requireMention: false, security: { media: { maxDownloadBytes: 32 } } },
      }),
    );
    const sent = sendGroupMeMediaMock.mock.calls[0]?.[0] as
      | { mediaReadFile?: (filePath: string) => Promise<Buffer> }
      | undefined;
    const mediaReadFile = sent?.mediaReadFile;
    if (!mediaReadFile) {
      throw new Error("expected deliver to forward a host-scoped mediaReadFile");
    }

    await expect(mediaReadFile(allowed)).resolves.toEqual(Buffer.from("png-bytes"));
    await expect(mediaReadFile("/etc/hostname")).rejects.toThrow(/not under an allowed directory/);
    await expect(mediaReadFile(tooBig)).rejects.toThrow("Media exceeds 32B limit");
  });

  it("uses singular mediaUrl when mediaUrls is absent", async () => {
    await deliver({ text: "", mediaUrl: "https://example.com/only.png" });

    expect(sendGroupMeMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        mediaUrl: "https://example.com/only.png",
      }),
    );
    expect(sendGroupMeTextMock).not.toHaveBeenCalled();
  });

  it("falls back to the maximum text limit for invalid account chunk limits", async () => {
    await deliver(
      { text: "hello" },
      buildAccount({ config: { requireMention: false, textChunkLimit: 0 } }),
    );
    await deliver(
      { text: "hello" },
      buildAccount({ config: { requireMention: false, textChunkLimit: Number.NaN } }),
    );
    await deliver(
      { text: "hello" },
      buildAccount({ config: { requireMention: false, textChunkLimit: 50_000 } }),
    );

    expect(core.fns.chunkMarkdownText.mock.calls.map((call) => call[1])).toEqual([
      1000, 1000, 1000,
    ]);
  });

  it("sanitizes assistant text through preparePayload before delivery", async () => {
    await deliver({ text: "<think>internal plan</think>ok!" });

    expect(sendGroupMeTextMock).toHaveBeenCalledTimes(1);
    expect(sendGroupMeTextMock).toHaveBeenCalledWith(expect.objectContaining({ text: "ok!" }));
  });

  it("passes media-only payloads through preparePayload unchanged", async () => {
    await deliver({ text: "" });
    const { delivery } = lastDispatch(core);
    const mediaOnly: ReplyPayload = { mediaUrl: "https://example.com/a.png" };

    expect(await delivery.preparePayload?.(mediaOnly, { kind: "final" })).toBe(mediaOnly);
  });

  it("asks core to deliver durably to the GroupMe group target", async () => {
    await deliver({ text: "hello" });
    const { delivery } = lastDispatch(core);

    expect(typeof delivery.durable).toBe("function");
    const durable = delivery.durable as (payload: ReplyPayload, info: { kind: "final" }) => unknown;
    expect(durable({ text: "hello" }, { kind: "final" })).toEqual({
      to: "groupme:group:group-1",
    });
  });

  it("drops senders blocked by allowFrom before dispatch", async () => {
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage({ senderId: "blocked-user" }),
      account: buildAccount({ config: { requireMention: false, allowFrom: ["allowed-user"] } }),
      config: {} as CoreConfig,
      runtime,
      groupHistories: new Map(),
      historyLimit: 0,
    });

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith(
      "groupme: drop sender blocked-user (not in allowFrom)",
    );
  });

  it("admits every member when allowFrom is empty", async () => {
    await handleGroupMeInbound({
      message: buildMessage({ senderId: "someone-new" }),
      account: buildAccount({ config: { requireMention: false, allowFrom: [] } }),
      config: {} as CoreConfig,
      runtime: buildRuntimeEnv(),
      groupHistories: new Map(),
      historyLimit: 0,
    });

    expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
  });

  it("logs when session recording reports an error", async () => {
    const { runtime } = await deliver({ text: "hello" });

    lastDispatch(core).record?.onRecordError?.(new Error("boom"));

    expect(runtime.error).toHaveBeenCalledWith(
      "groupme: failed updating session meta: Error: boom",
    );
  });

  it("exposes reply error and block streaming options to the dispatcher", async () => {
    const { runtime } = await deliver(
      { text: "hello" },
      buildAccount({ config: { requireMention: false, blockStreaming: false } }),
    );

    const params = lastDispatch(core);
    expect(params.replyOptions?.disableBlockStreaming).toBe(true);
    expect(params.replyPipeline).toEqual({});

    params.delivery.onError?.(new Error("send failed"), { kind: "text" } as never);
    expect(runtime.error).toHaveBeenCalledWith("groupme text reply failed: Error: send failed");
  });

  it("leaves block streaming to core defaults when the account does not set it", async () => {
    await deliver({ text: "hello" });
    expect(lastDispatch(core).replyOptions?.disableBlockStreaming).toBeUndefined();

    await deliver(
      { text: "hello" },
      buildAccount({ config: { requireMention: false, blockStreaming: true } }),
    );
    expect(lastDispatch(core).replyOptions?.disableBlockStreaming).toBe(false);
  });
});
