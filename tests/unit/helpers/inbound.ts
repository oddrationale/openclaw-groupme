import { buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import { resolveStableChannelMessageIngress } from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { PluginRuntime, ReplyPayload } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { vi } from "vitest";
import type { GroupMeCallbackData, ResolvedGroupMeAccount } from "../../../src/types.js";

/** Params core receives from `handleGroupMeInbound` via `channel.inbound.dispatch`. */
export type InboundDispatchParams = Parameters<PluginRuntime["channel"]["inbound"]["dispatch"]>[0];
/** Params core receives from `handleGroupMeInbound` via `channel.inbound.buildContext`. */
export type InboundBuildContextParams = Parameters<
  PluginRuntime["channel"]["inbound"]["buildContext"]
>[0];
/** Params core receives from `handleGroupMeInbound` via `channel.inbound.ingress.resolveStable`. */
export type InboundIngressParams = Parameters<
  PluginRuntime["channel"]["inbound"]["ingress"]["resolveStable"]
>[0];

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
 * Emulates the part of core's routed-turn dispatch that a channel's delivery
 * adapter observes: the reply payload is passed through `preparePayload` and then
 * handed to `deliver`. Core's durable queue is not modeled; `deliver` is the
 * fallback core uses when durable delivery does not handle a payload.
 */
export async function deliverThroughCore(
  params: InboundDispatchParams,
  payload: ReplyPayload,
  info: { kind: "tool" | "block" | "final" } = { kind: "final" },
) {
  const prepared = params.delivery.preparePayload
    ? await params.delivery.preparePayload(payload, info)
    : payload;
  // A null prepared payload means the channel dropped it; core skips delivery.
  return prepared === null ? undefined : await params.delivery.deliver(prepared, info);
}

/**
 * Builds the OpenClaw `PluginRuntime` channel-surface fake shared by the
 * `handleGroupMeInbound` unit suites. Returns the individual `vi.fn()`s (for
 * assertions and per-test overrides) alongside the assembled `runtime` object.
 *
 * Ingress policy and context building are NOT stubbed: `ingress.resolveStable`
 * runs the SDK's real `resolveStableChannelMessageIngress` and `buildContext`
 * runs the real `buildChannelInboundEventContext`, so allowlist, command, and
 * mention decisions (and the finalized context fields) match what core does.
 * Only `dispatch` (the agent turn) is a no-op by default.
 *
 * Usage with the runtime singleton mock — note `core` is intentionally NOT
 * `vi.hoisted` so this helper can be imported normally; the `getGroupMeRuntime`
 * arrow reads `core.runtime` lazily, after module init completes:
 *
 *   const core = createInboundCoreMock();
 *   vi.mock("../../src/runtime.js", () => ({
 *     getGroupMeRuntime: () => core.runtime,
 *     tryGetGroupMeRuntime: () => core.runtime,
 *   }));
 */
export function createInboundCoreMock(
  options: { handleTextCommands?: boolean; hasControlCommand?: boolean } = {},
) {
  const fns = {
    activityRecord: vi.fn(),
    resolveAgentRoute: vi.fn(() => ({
      agentId: "agent-main",
      sessionKey: "agent:agent-main:groupme:group:group-1",
      accountId: "default",
    })),
    buildMentionRegexes: vi.fn(() => [] as RegExp[]),
    shouldHandleTextCommands: vi.fn(() => options.handleTextCommands ?? false),
    hasControlCommand: vi.fn(() => options.hasControlCommand ?? false),
    chunkMarkdownText: vi.fn((text: string, _limit?: number) => [text]),
    resolveStable: vi.fn((params: InboundIngressParams) =>
      resolveStableChannelMessageIngress(params),
    ),
    buildContext: vi.fn((params: InboundBuildContextParams) =>
      buildChannelInboundEventContext(params),
    ),
    dispatch: vi.fn(async (_params: InboundDispatchParams) => undefined),
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
        inbound: {
          ingress: { resolveStable: fns.resolveStable },
          buildContext: fns.buildContext,
          dispatch: fns.dispatch,
        },
      },
    },
  };
}

/** Last finalized context handed to core, as a plain record for field assertions. */
export function lastContext(core: ReturnType<typeof createInboundCoreMock>) {
  const result = core.fns.buildContext.mock.results.at(-1);
  if (result?.type !== "return") {
    throw new Error("expected buildContext to have returned a context");
  }
  return result.value as unknown as Record<string, unknown>;
}

/** Last dispatch params handed to core. */
export function lastDispatch(core: ReturnType<typeof createInboundCoreMock>) {
  const params = core.fns.dispatch.mock.calls.at(-1)?.[0];
  if (!params) {
    throw new Error("expected channel.inbound.dispatch to have been called");
  }
  return params;
}
