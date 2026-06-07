import type { ReplyPayload } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { vi } from "vitest";
import type { GroupMeCallbackData, ResolvedGroupMeAccount } from "../../../src/types.js";

export function buildRuntimeEnv(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: (() => {
      throw new Error("exit");
    }) as RuntimeEnv["exit"],
  };
}

export function buildAccount(
  overrides: Partial<ResolvedGroupMeAccount> = {},
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

export function buildMessage(overrides: Partial<GroupMeCallbackData> = {}): GroupMeCallbackData {
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

/**
 * Builds the OpenClaw `PluginRuntime` channel-surface mock shared by the
 * `handleGroupMeInbound` unit suites. Returns the individual `vi.fn()`s (for
 * assertions and per-test overrides) alongside the assembled `runtime` object.
 *
 * Usage with the runtime singleton mock — note `core` is intentionally NOT
 * `vi.hoisted` so this helper can be imported normally; the `getGroupMeRuntime`
 * arrow reads `core.runtime` lazily, after module init completes:
 *
 *   const core = createInboundCoreMock();
 *   vi.mock("../../src/runtime.js", () => ({ getGroupMeRuntime: () => core.runtime }));
 */
export function createInboundCoreMock(
  options: { handleTextCommands?: boolean; hasControlCommand?: boolean } = {},
) {
  const fns = {
    activityRecord: vi.fn(),
    resolveAgentRoute: vi.fn(() => ({
      agentId: "agent-main",
      sessionKey: "session-main",
      accountId: "default",
    })),
    buildMentionRegexes: vi.fn(() => [] as RegExp[]),
    shouldHandleTextCommands: vi.fn(() => options.handleTextCommands ?? false),
    hasControlCommand: vi.fn(() => options.hasControlCommand ?? false),
    resolveEnvelopeFormatOptions: vi.fn(() => ({})),
    resolveStorePath: vi.fn(() => "/tmp/groupme-session"),
    readSessionUpdatedAt: vi.fn(() => undefined),
    formatAgentEnvelope: vi.fn((params: { body: string }) => `ENV:${params.body}`),
    finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
    recordInboundSession: vi.fn(async (_params: unknown) => undefined),
    dispatchReplyWithBufferedBlockDispatcher: vi.fn(async (_params: unknown) => undefined),
    chunkMarkdownText: vi.fn((text: string, _limit?: number) => [text]),
  };

  return {
    fns,
    nextPayload: { text: "reply" } as ReplyPayload,
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
}
