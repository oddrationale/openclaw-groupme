import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../../src/types.js";
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

describe("handleGroupMeInbound context payload", () => {
  beforeEach(() => {
    for (const fn of Object.values(core.fns)) {
      fn.mockClear();
    }
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
    const ctx = core.fns.finalizeInboundContext.mock.calls[0][0] as Record<string, unknown>;
    expect(ctx.GroupSpace).toBe("group-42");
  });

  it("defaults requireMention to true when the account omits it", async () => {
    const groupHistories = new Map();
    await handleGroupMeInbound({
      message: buildMessage({ text: "just chatting, no mention" }),
      account: buildAccount({ config: { botName: "oddclaw" } }),
      config: {} as CoreConfig,
      runtime: buildRuntimeEnv(),
      groupHistories,
      historyLimit: 2,
    });

    // requireMention defaulted to true → a non-mention message is buffered, not dispatched.
    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toHaveLength(1);
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

    const ctx = core.fns.finalizeInboundContext.mock.calls[0][0] as Record<string, unknown>;
    expect(ctx.GroupChannel).toBeUndefined();
  });
});
