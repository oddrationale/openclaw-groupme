import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  CoreConfig,
  GroupMeCallbackData,
  ResolvedGroupMeAccount,
} from "./types.js";

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
    formatAgentEnvelope: vi.fn(
      (params: { body: string }) => `ENV:${params.body}`,
    ),
    finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
    recordInboundSession: vi.fn(async () => undefined),
    dispatchReplyWithBufferedBlockDispatcher: vi.fn(
      async (_params: unknown) => undefined,
    ),
    chunkMarkdownText: vi.fn((text: string) => [text]),
  };

  return {
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
          dispatchReplyWithBufferedBlockDispatcher:
            fns.dispatchReplyWithBufferedBlockDispatcher,
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

vi.mock("./runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
}));

import { handleGroupMeInbound } from "./inbound.js";

function buildRuntimeEnv(): RuntimeEnv {
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
      requireMention: true,
      botName: "oddclaw",
    },
    ...overrides,
  };
}

function buildMessage(
  overrides?: Partial<GroupMeCallbackData>,
): GroupMeCallbackData {
  return {
    id: "msg-1",
    text: "hello everyone",
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

describe("handleGroupMeInbound history buffer", () => {
  beforeEach(() => {
    Object.values(core.fns).forEach((fn) => fn.mockClear());
  });

  it("buffers non-mentioned messages when requireMention is true", async () => {
    const groupHistories = new Map();
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage({ text: "no mention text" }),
      account: buildAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 2,
    });

    expect(
      core.fns.dispatchReplyWithBufferedBlockDispatcher,
    ).not.toHaveBeenCalled();
    expect(core.fns.recordInboundSession).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toEqual([
      {
        sender: "Alice",
        body: "no mention text",
        timestamp: 1_700_000_000_000,
        messageId: "msg-1",
      },
    ]);
  });

  it("does not buffer when historyLimit is zero", async () => {
    const groupHistories = new Map();
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage({ text: "still no mention" }),
      account: buildAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 0,
    });

    expect(
      core.fns.dispatchReplyWithBufferedBlockDispatcher,
    ).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toBeUndefined();
  });

  it("injects buffered history for mentioned messages and clears after dispatch", async () => {
    const groupHistories = new Map([
      [
        "group-1",
        [
          {
            sender: "Bob",
            body: "pizza tonight?",
            timestamp: 1_700_000_000_100,
            messageId: "m0",
          },
        ],
      ],
    ]);
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage({ text: "@oddclaw what do you think?" }),
      account: buildAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 3,
    });

    expect(
      core.fns.dispatchReplyWithBufferedBlockDispatcher,
    ).toHaveBeenCalledTimes(1);
    const dispatched = core.fns.dispatchReplyWithBufferedBlockDispatcher.mock
      .calls[0]?.[0] as
      | { ctx?: { Body?: string; InboundHistory?: unknown[] } }
      | undefined;
    expect(dispatched?.ctx?.Body).toContain(
      "[Chat messages since your last reply - for context]",
    );
    expect(dispatched?.ctx?.Body).toContain(
      "[Current message - respond to this]",
    );
    expect(dispatched?.ctx?.Body).toContain("Bob: pizza tonight?");
    expect(dispatched?.ctx?.InboundHistory).toEqual([
      {
        sender: "Bob",
        body: "pizza tonight?",
        timestamp: 1_700_000_000_100,
      },
    ]);
    expect(groupHistories.get("group-1")).toEqual([]);
  });
});
