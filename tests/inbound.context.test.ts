import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoreConfig,
  GroupMeCallbackData,
  ResolvedGroupMeAccount,
} from "../src/types.js";

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

vi.mock("../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
}));

import { handleGroupMeInbound } from "../src/inbound.js";

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
      requireMention: false,
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
    text: "hello",
    name: "Alice",
    senderType: "user",
    senderId: "user-1",
    userId: "user-1",
    groupId: "group-42",
    sourceGuid: "source-1",
    createdAt: 1_700_000_000,
    system: false,
    avatarUrl: null,
    attachments: [],
    ...overrides,
  };
}

describe("handleGroupMeInbound context payload", () => {
  beforeEach(() => {
    Object.values(core.fns).forEach((fn) => fn.mockClear());
  });

  it("sets GroupSpace to the message groupId", async () => {
    await handleGroupMeInbound({
      message: buildMessage({ groupId: "group-42" }),
      account: buildAccount(),
      config: {} as CoreConfig,
      runtime: buildRuntimeEnv(),
      groupHistories: new Map(),
      historyLimit: 20,
    });

    expect(core.fns.finalizeInboundContext).toHaveBeenCalledTimes(1);
    const ctx = core.fns.finalizeInboundContext.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(ctx.GroupSpace).toBe("group-42");
  });

  it("does not set GroupChannel (not available from callback)", async () => {
    await handleGroupMeInbound({
      message: buildMessage(),
      account: buildAccount(),
      config: {} as CoreConfig,
      runtime: buildRuntimeEnv(),
      groupHistories: new Map(),
      historyLimit: 20,
    });

    const ctx = core.fns.finalizeInboundContext.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(ctx.GroupChannel).toBeUndefined();
  });
});
