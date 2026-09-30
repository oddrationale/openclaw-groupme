import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../../src/types.js";
import {
  buildAccount,
  buildMessage,
  buildRuntimeEnv,
  createInboundCoreMock,
  lastContext,
  lastDispatch,
} from "./helpers/inbound.js";

const core = createInboundCoreMock();

vi.mock("../../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
  tryGetGroupMeRuntime: () => core.runtime,
}));

import { resolveStableChannelMessageIngress } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { handleGroupMeInbound } from "../../src/inbound.js";

async function handle(
  params: Partial<Parameters<typeof handleGroupMeInbound>[0]> = {},
): Promise<ReturnType<typeof buildRuntimeEnv>> {
  const runtime = params.runtime ?? buildRuntimeEnv();
  await handleGroupMeInbound({
    message: buildMessage(),
    account: buildAccount(),
    config: {} as CoreConfig,
    runtime,
    groupHistories: new Map(),
    historyLimit: 20,
    ...params,
  });
  return runtime;
}

describe("handleGroupMeInbound context payload", () => {
  beforeEach(() => {
    for (const fn of Object.values(core.fns)) {
      fn.mockClear();
    }
  });

  it("records inbound activity and status before routing", async () => {
    const statusSink = vi.fn();
    await handle({ statusSink });

    expect(statusSink).toHaveBeenCalledWith({ lastInboundAt: 1_700_000_000_000 });
    expect(core.fns.activityRecord).toHaveBeenCalledWith({
      channel: "groupme",
      accountId: "default",
      direction: "inbound",
      at: 1_700_000_000_000,
    });
    expect(core.fns.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "groupme",
        accountId: "default",
        peer: { kind: "group", id: "group-1" },
      }),
    );
  });

  it("builds the finalized group context core dispatches", async () => {
    await handle({ message: buildMessage({ groupId: "group-42", text: "hi there" }) });

    expect(core.fns.buildContext).toHaveBeenCalledTimes(1);
    const ctx = lastContext(core);
    expect(ctx).toEqual(
      expect.objectContaining({
        Provider: "groupme",
        Surface: "groupme",
        ChatType: "group",
        ChatId: "group-42",
        GroupSpace: "group-42",
        ConversationLabel: "groupme:group-42",
        From: "groupme:user:user-1",
        To: "groupme:group:group-42",
        OriginatingChannel: "groupme",
        OriginatingTo: "groupme:group:group-42",
        SenderId: "user-1",
        SenderName: "Alice",
        MessageSid: "msg-1",
        Timestamp: 1_700_000_000_000,
        BodyForAgent: "hi there",
        RawBody: "hi there",
        CommandBody: "hi there",
        CommandAuthorized: false,
        WasMentioned: false,
        AgentId: "agent-main",
        SessionKey: "agent:agent-main:groupme:group:group-1",
      }),
    );
    // The envelope wraps the agent body with the channel and sender labels.
    expect(ctx.Body).toEqual(expect.stringContaining("hi there"));
    expect(ctx.Body).toEqual(expect.stringContaining("GroupMe"));
    expect(ctx.Body).toEqual(expect.stringContaining("Alice"));

    const dispatched = lastDispatch(core);
    expect(dispatched.ctxPayload).toBe(ctx);
    expect(dispatched).toEqual(
      expect.objectContaining({
        channel: "groupme",
        accountId: "default",
        route: {
          agentId: "agent-main",
          dmScope: undefined,
          sessionKey: "agent:agent-main:groupme:group:group-1",
        },
      }),
    );
  });

  it("does not set GroupChannel (not available from callback)", async () => {
    await handle();

    expect(lastContext(core).GroupChannel).toBeUndefined();
  });

  it("adds image attachments as media facts and to the agent body", async () => {
    await handle({
      message: buildMessage({
        text: "look",
        attachments: [
          { type: "image", url: "https://i.groupme.com/one.png" },
          { type: "location", lat: "1", lng: "2", name: "here" },
          { type: "image", url: "https://i.groupme.com/two.jpeg" },
        ],
      }),
    });

    const ctx = lastContext(core);
    expect(ctx.media).toEqual([
      expect.objectContaining({
        url: "https://i.groupme.com/one.png",
        kind: "image",
        messageId: "msg-1",
      }),
      expect.objectContaining({
        url: "https://i.groupme.com/two.jpeg",
        kind: "image",
        messageId: "msg-1",
      }),
    ]);
    // Caption text wins for the agent body; the images travel as media facts.
    expect(ctx.BodyForAgent).toBe("look");
    expect(ctx.RawBody).toBe("look");
  });

  it("describes image-only messages to the agent by URL", async () => {
    await handle({
      message: buildMessage({
        text: "",
        attachments: [{ type: "image", url: "https://i.groupme.com/only.png" }],
      }),
    });

    const ctx = lastContext(core);
    expect(ctx.BodyForAgent).toBe("Image: https://i.groupme.com/only.png");
    expect(ctx.media).toEqual([
      expect.objectContaining({ url: "https://i.groupme.com/only.png", kind: "image" }),
    ]);
  });

  it("carries no media facts for text-only messages", async () => {
    await handle();

    expect(lastContext(core).media).toEqual([]);
  });

  it("defaults requireMention to true when the account omits it", async () => {
    const groupHistories = new Map();
    await handle({
      message: buildMessage({ text: "just chatting, no mention" }),
      account: buildAccount({ config: { botName: "oddclaw" } }),
      groupHistories,
      historyLimit: 2,
    });

    // requireMention defaulted to true → a non-mention message is buffered, not dispatched.
    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toHaveLength(1);
  });

  it("detects mentions through core mention regexes", async () => {
    core.fns.buildMentionRegexes.mockReturnValueOnce([/\bclawbot\b/i]);

    await handle({
      message: buildMessage({ text: "hey clawbot, ping" }),
      account: buildAccount({ config: { requireMention: true, botName: "oddclaw" } }),
    });

    expect(core.fns.buildMentionRegexes).toHaveBeenCalledWith({}, "agent-main");
    expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    expect(lastContext(core).WasMentioned).toBe(true);
  });

  it("drops messages that core ingress admits for a non-dispatch outcome", async () => {
    // Defensive: GroupMe maps every non-dispatch decision it knows about (sender,
    // command, activation) before this point. A future core gate could still
    // return another admission; that must never reach dispatch.
    core.fns.resolveStable.mockImplementationOnce(async (params) => {
      const resolved = await resolveStableChannelMessageIngress(params);
      return {
        ...resolved,
        ingress: { ...resolved.ingress, admission: "drop", reasonCode: "route_blocked" },
      } as typeof resolved;
    });

    const runtime = await handle();

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith(
      "groupme: drop message msg-1 (admission=drop, reason=route_blocked)",
    );
  });

  it("falls back to the detected mention when core omits the effective mention", async () => {
    core.fns.resolveStable.mockImplementationOnce(async (params) => {
      const resolved = await resolveStableChannelMessageIngress(params);
      return {
        ...resolved,
        activationAccess: { ...resolved.activationAccess, effectiveWasMentioned: undefined },
      } as typeof resolved;
    });

    await handle({ message: buildMessage({ text: "@oddclaw hi" }) });

    expect(lastContext(core).WasMentioned).toBe(true);
  });
});
