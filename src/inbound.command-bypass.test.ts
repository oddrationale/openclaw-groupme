import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    shouldHandleTextCommands: vi.fn(() => true),
    hasControlCommand: vi.fn(() => true),
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
    text: "/help",
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

describe("handleGroupMeInbound command bypass security", () => {
  beforeEach(() => {
    Object.values(core.fns).forEach((fn) => fn.mockClear());
  });

  it("blocks command bypass when allowFrom is empty and requireAllowFrom is true", async () => {
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage(),
      account: buildAccount({
        config: {
          requireMention: true,
          botName: "oddclaw",
          security: {
            commandBypass: {
              requireAllowFrom: true,
              requireMentionForCommands: false,
            },
          },
        },
      }),
      config: { commands: { useAccessGroups: false } } as CoreConfig,
      runtime,
      groupHistories: new Map(),
      historyLimit: 20,
    });

    expect(
      core.fns.dispatchReplyWithBufferedBlockDispatcher,
    ).not.toHaveBeenCalled();
  });

  it("allows command bypass when explicitly configured", async () => {
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage(),
      account: buildAccount({
        config: {
          requireMention: true,
          botName: "oddclaw",
          security: {
            commandBypass: {
              requireAllowFrom: false,
              requireMentionForCommands: false,
            },
          },
        },
      }),
      config: { commands: { useAccessGroups: false } } as CoreConfig,
      runtime,
      groupHistories: new Map(),
      historyLimit: 20,
    });

    expect(
      core.fns.dispatchReplyWithBufferedBlockDispatcher,
    ).toHaveBeenCalledTimes(1);
  });

  it("requires mention for commands in strict mode", async () => {
    const runtime = buildRuntimeEnv();
    const groupHistories = new Map();

    await handleGroupMeInbound({
      message: buildMessage({ text: "/status" }),
      account: buildAccount({
        config: {
          requireMention: true,
          botName: "oddclaw",
          allowFrom: ["user-1"],
          security: {
            commandBypass: {
              requireAllowFrom: true,
              requireMentionForCommands: true,
            },
          },
        },
      }),
      config: { commands: { useAccessGroups: true } } as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 20,
    });

    expect(
      core.fns.dispatchReplyWithBufferedBlockDispatcher,
    ).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toHaveLength(1);
  });
});
