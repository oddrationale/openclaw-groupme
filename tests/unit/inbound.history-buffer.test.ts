import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig, ResolvedGroupMeAccount } from "../../src/types.js";
import {
  buildAccount,
  buildMessage,
  buildRuntimeEnv,
  createInboundCoreMock,
  lastContext,
} from "./helpers/inbound.js";

const core = createInboundCoreMock();

vi.mock("../../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
  tryGetGroupMeRuntime: () => core.runtime,
}));

import { handleGroupMeInbound } from "../../src/inbound.js";

type GroupHistories = Parameters<typeof handleGroupMeInbound>[0]["groupHistories"];

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
    const groupHistories: GroupHistories = new Map();
    const runtime = buildRuntimeEnv();

    await handleGroupMeInbound({
      message: buildMessage({ text: "no mention text" }),
      account: buildMentionAccount(),
      config: {} as CoreConfig,
      runtime,
      groupHistories,
      historyLimit: 2,
    });

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(core.fns.buildContext).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toEqual([
      {
        sender: "Alice",
        body: "no mention text",
        timestamp: 1_700_000_000_000,
        messageId: "msg-1",
      },
    ]);
    expect(runtime.log).toHaveBeenCalledWith("groupme: buffered message from Alice (1/2)");
  });

  it("keeps only the most recent historyLimit entries", async () => {
    const groupHistories: GroupHistories = new Map();

    for (const [index, text] of ["one", "two", "three"].entries()) {
      await handleGroupMeInbound({
        message: buildMessage({ id: `m${index}`, text }),
        account: buildMentionAccount(),
        config: {} as CoreConfig,
        runtime: buildRuntimeEnv(),
        groupHistories,
        historyLimit: 2,
      });
    }

    expect(groupHistories.get("group-1")?.map((entry) => entry.body)).toEqual(["two", "three"]);
  });

  it("does not buffer when historyLimit is zero and explains the drop once", async () => {
    const groupHistories: GroupHistories = new Map();
    const first = buildRuntimeEnv();
    const second = buildRuntimeEnv();

    for (const runtime of [first, second]) {
      await handleGroupMeInbound({
        // A group id unique to this test: the "no mention" hint is logged once per
        // account/group for the process lifetime.
        message: buildMessage({ text: "still no mention", groupId: "group-no-history" }),
        account: buildMentionAccount(),
        config: {} as CoreConfig,
        runtime,
        groupHistories,
        historyLimit: 0,
      });
    }

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(groupHistories.get("group-no-history")).toBeUndefined();
    expect(first.log).toHaveBeenCalledWith(
      expect.stringMatching(/^groupme: drop no mention target=group-no-history\. Mention the bot/),
    );
    expect(second.log).not.toHaveBeenCalled();
  });

  it("injects buffered history for mentioned messages and clears after dispatch", async () => {
    const groupHistories: GroupHistories = new Map([
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

    await handleGroupMeInbound({
      message: buildMessage({ text: "@oddclaw what do you think?" }),
      account: buildMentionAccount(),
      config: {} as CoreConfig,
      runtime: buildRuntimeEnv(),
      groupHistories,
      historyLimit: 3,
    });

    expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    const ctx = lastContext(core);
    expect(ctx.Body).toContain("[Chat messages since your last reply - for context]");
    expect(ctx.Body).toContain("[Current message - respond to this]");
    expect(ctx.Body).toContain("Bob: pizza tonight?");
    expect(ctx.Body).toContain("@oddclaw what do you think?");
    expect(ctx.BodyForAgent).toBe("@oddclaw what do you think?");
    expect(ctx.WasMentioned).toBe(true);
    expect(ctx.InboundHistory).toEqual([
      {
        sender: "Bob",
        body: "pizza tonight?",
        timestamp: 1_700_000_000_100,
        messageId: "m0",
      },
    ]);
    expect(groupHistories.get("group-1")).toEqual([]);
  });

  it("snapshots and clears the buffer before dispatch starts", async () => {
    const groupHistories: GroupHistories = new Map([
      [
        "group-1",
        [{ sender: "Bob", body: "earlier", timestamp: 1_700_000_000_100, messageId: "m0" }],
      ],
    ]);
    let bufferSeenByDispatch: unknown;
    core.fns.dispatch.mockImplementationOnce(async () => {
      bufferSeenByDispatch = structuredClone(groupHistories.get("group-1"));
    });

    await handleGroupMeInbound({
      message: buildMessage({ text: "@oddclaw go" }),
      account: buildMentionAccount(),
      config: {} as CoreConfig,
      runtime: buildRuntimeEnv(),
      groupHistories,
      historyLimit: 3,
    });

    expect(bufferSeenByDispatch).toEqual([]);
    expect(lastContext(core).Body).toContain("Bob: earlier");
  });

  it("preserves messages buffered while mention dispatch is in flight", async () => {
    const groupHistories: GroupHistories = new Map([
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

    core.fns.dispatch.mockImplementationOnce(async () => {
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
      runtime: buildRuntimeEnv(),
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

  it("skips the history window entirely when requireMention is false", async () => {
    const groupHistories: GroupHistories = new Map([
      [
        "group-1",
        [{ sender: "Bob", body: "stale", timestamp: 1_700_000_000_100, messageId: "m0" }],
      ],
    ]);

    await handleGroupMeInbound({
      message: buildMessage({ text: "hello" }),
      account: buildAccount({ config: { requireMention: false } }),
      config: {} as CoreConfig,
      runtime: buildRuntimeEnv(),
      groupHistories,
      historyLimit: 3,
    });

    const ctx = lastContext(core);
    expect(ctx.Body).not.toContain("stale");
    expect(ctx.InboundHistory).toBeUndefined();
    expect(groupHistories.get("group-1")).toHaveLength(1);
  });
});
