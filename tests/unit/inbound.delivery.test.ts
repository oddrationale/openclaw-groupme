import type { ReplyPayload } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig, GroupMeCallbackData, ResolvedGroupMeAccount } from "../../src/types.js";

const core = vi.hoisted(() => {
  const fns = {
    activityRecord: vi.fn(),
    resolveAgentRoute: vi.fn(() => ({
      agentId: "agent-main",
      sessionKey: "session-main",
      accountId: "default",
    })),
    buildMentionRegexes: vi.fn(() => []),
    shouldHandleTextCommands: vi.fn(() => false),
    hasControlCommand: vi.fn(() => false),
    resolveEnvelopeFormatOptions: vi.fn(() => ({})),
    resolveStorePath: vi.fn(() => "/tmp/groupme-session"),
    readSessionUpdatedAt: vi.fn(() => undefined),
    formatAgentEnvelope: vi.fn((params: { body: string }) => `ENV:${params.body}`),
    finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
    recordInboundSession: vi.fn(async () => undefined),
    dispatchReplyWithBufferedBlockDispatcher: vi.fn(async (params: DispatcherParams) => {
      await params.dispatcherOptions.deliver(core.nextPayload);
    }),
    chunkMarkdownText: vi.fn((text: string, limit: number) =>
      text.length > limit ? [text.slice(0, limit), text.slice(limit)] : [text],
    ),
  };

  return {
    nextPayload: { text: "reply" } as ReplyPayload,
    fns,
    runtime: {
      channel: {
        activity: { record: fns.activityRecord },
        routing: { resolveAgentRoute: fns.resolveAgentRoute },
        mentions: { buildMentionRegexes: fns.buildMentionRegexes },
        commands: { shouldHandleTextCommands: fns.shouldHandleTextCommands },
        text: {
          hasControlCommand: fns.hasControlCommand,
          chunkMarkdownText: fns.chunkMarkdownText,
        },
        reply: {
          resolveEnvelopeFormatOptions: fns.resolveEnvelopeFormatOptions,
          formatAgentEnvelope: fns.formatAgentEnvelope,
          finalizeInboundContext: fns.finalizeInboundContext,
          dispatchReplyWithBufferedBlockDispatcher: fns.dispatchReplyWithBufferedBlockDispatcher,
        },
        session: {
          resolveStorePath: fns.resolveStorePath,
          readSessionUpdatedAt: fns.readSessionUpdatedAt,
          recordInboundSession: fns.recordInboundSession,
        },
      },
    },
  };
});

const sendGroupMeTextMock = vi.hoisted(() => vi.fn());
const sendGroupMeMediaMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
}));

vi.mock("../../src/send.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/send.js")>();
  return {
    ...actual,
    sendGroupMeText: sendGroupMeTextMock,
    sendGroupMeMedia: sendGroupMeMediaMock,
  };
});

type DispatcherParams = {
  dispatcherOptions: {
    deliver: (payload: ReplyPayload) => Promise<void>;
  };
};

import { handleGroupMeInbound } from "../../src/inbound.js";

function buildRuntimeEnv(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: (() => {
      throw new Error("exit");
    }) as RuntimeEnv["exit"],
  };
}

function buildAccount(overrides?: Partial<ResolvedGroupMeAccount>): ResolvedGroupMeAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    botId: "bot-1",
    accessToken: "token-1",
    config: {
      requireMention: false,
      botName: "oddclaw",
      textChunkLimit: 5,
    },
    ...overrides,
  };
}

function buildMessage(overrides?: Partial<GroupMeCallbackData>): GroupMeCallbackData {
  return {
    id: "msg-1",
    text: "hello",
    name: "Alice",
    senderType: "user",
    senderId: "user-1",
    userId: "user-1",
    groupId: "group-1",
    sourceGuid: "source-1",
    createdAt: 1_700_000_000,
    system: false,
    avatarUrl: null,
    attachments: [],
    ...overrides,
  };
}

async function deliver(payload: ReplyPayload, account = buildAccount()) {
  core.nextPayload = payload;
  const statusSink = vi.fn();
  const runtime = buildRuntimeEnv();

  await handleGroupMeInbound({
    message: buildMessage(),
    account,
    config: { channels: { groupme: { botId: "bot-1", accessToken: "token-1" } } } as CoreConfig,
    runtime,
    groupHistories: new Map(),
    historyLimit: 0,
    statusSink,
  });

  return { runtime, statusSink };
}

describe("handleGroupMeInbound reply delivery", () => {
  beforeEach(() => {
    core.nextPayload = { text: "reply" };
    for (const fn of Object.values(core.fns)) {
      fn.mockClear();
    }
    sendGroupMeTextMock.mockReset();
    sendGroupMeMediaMock.mockReset();
    sendGroupMeTextMock.mockResolvedValue({ messageId: "text-id", timestamp: 1 });
    sendGroupMeMediaMock.mockResolvedValue({ messageId: "media-id", timestamp: 2 });
  });

  it("drops empty reply payloads without sending", async () => {
    await deliver({ text: "  " });

    expect(sendGroupMeTextMock).not.toHaveBeenCalled();
    expect(sendGroupMeMediaMock).not.toHaveBeenCalled();
  });

  it("chunks text replies using the account limit and records outbound activity", async () => {
    const { statusSink } = await deliver({ text: "helloworld" });

    expect(core.fns.chunkMarkdownText).toHaveBeenCalledWith("helloworld", 5);
    expect(sendGroupMeTextMock).toHaveBeenCalledTimes(2);
    expect(sendGroupMeTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: "hello", to: "groupme:group:group-1" }),
    );
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
  });

  it("sends first media with first text chunk, then remaining chunks and media", async () => {
    await deliver({
      text: "caption!",
      mediaUrls: ["https://example.com/one.png", "https://example.com/two.png"],
    });

    expect(sendGroupMeMediaMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: "capti",
        mediaUrl: "https://example.com/one.png",
      }),
    );
    expect(sendGroupMeTextMock).toHaveBeenCalledWith(expect.objectContaining({ text: "on!" }));
    expect(sendGroupMeMediaMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: "",
        mediaUrl: "https://example.com/two.png",
      }),
    );
  });

  it("uses singular mediaUrl when mediaUrls is absent", async () => {
    await deliver({ text: "", mediaUrl: "https://example.com/only.png" });

    expect(sendGroupMeMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        mediaUrl: "https://example.com/only.png",
      }),
    );
  });

  it("falls back to the maximum text limit for invalid account chunk limits", async () => {
    await deliver(
      { text: "hello" },
      buildAccount({ config: { requireMention: false, textChunkLimit: 0 } }),
    );

    expect(core.fns.chunkMarkdownText).toHaveBeenCalledWith("hello", 1000);
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

    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith(
      "groupme: drop sender blocked-user (not in allowFrom)",
    );
  });

  it("exposes reply error and block streaming options to the dispatcher", async () => {
    const { runtime } = await deliver(
      { text: "hello" },
      buildAccount({ config: { requireMention: false, blockStreaming: false } }),
    );

    const params = core.fns.dispatchReplyWithBufferedBlockDispatcher.mock
      .calls[0]?.[0] as unknown as
      | {
          dispatcherOptions: { onError: (error: unknown, info: { kind: string }) => void };
          replyOptions: { disableBlockStreaming?: boolean };
        }
      | undefined;
    expect(params?.replyOptions.disableBlockStreaming).toBe(true);

    params?.dispatcherOptions.onError(new Error("send failed"), { kind: "text" });
    expect(runtime.error).toHaveBeenCalledWith("groupme text reply failed: Error: send failed");
  });
});
