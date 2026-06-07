import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig, ResolvedGroupMeAccount } from "../../src/types.js";
import {
  buildAccount,
  buildMessage,
  buildRuntimeEnv,
  createInboundCoreMock,
} from "./helpers/inbound.js";

const core = createInboundCoreMock();

vi.mock("../../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
}));

import { handleGroupMeInbound } from "../../src/inbound.js";

function buildMentionAccount(
  overrides: Partial<ResolvedGroupMeAccount> = {},
): ResolvedGroupMeAccount {
  return buildAccount({ config: { requireMention: true, botName: "oddclaw" }, ...overrides });
}

describe("handleGroupMeInbound history buffer", () => {
  beforeEach(() => {
    for (const fn of Object.values(core.fns)) {
      fn.mockClear();
    }
  });

  it("buffers non-mentioned messages when requireMention is true", async () => {
    const groupHistories = new Map();
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage({ text: "no mention text" }),
      account: buildMentionAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 2,
    });

    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
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
      account: buildMentionAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 0,
    });

    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
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
      account: buildMentionAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 3,
    });

    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    const dispatched = core.fns.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0]?.[0] as
      | { ctx?: { Body?: string; InboundHistory?: unknown[] } }
      | undefined;
    expect(dispatched?.ctx?.Body).toContain("[Chat messages since your last reply - for context]");
    expect(dispatched?.ctx?.Body).toContain("[Current message - respond to this]");
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

  it("preserves messages buffered while mention dispatch is in flight", async () => {
    const groupHistories = new Map([
      [
        "group-1",
        [
          {
            sender: "Bob",
            body: "earlier context",
            timestamp: 1_700_000_000_100,
            messageId: "m0",
          },
        ],
      ],
    ]);
    const runtime = buildRuntimeEnv();

    core.fns.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async () => {
      groupHistories.set("group-1", [
        {
          sender: "Eve",
          body: "newly buffered while reply is running",
          timestamp: 1_700_000_000_200,
          messageId: "m1",
        },
      ]);
    });

    await handleGroupMeInbound({
      message: buildMessage({ text: "@oddclaw please answer" }),
      account: buildMentionAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 3,
    });

    expect(groupHistories.get("group-1")).toEqual([
      {
        sender: "Eve",
        body: "newly buffered while reply is running",
        timestamp: 1_700_000_000_200,
        messageId: "m1",
      },
    ]);
  });
});
