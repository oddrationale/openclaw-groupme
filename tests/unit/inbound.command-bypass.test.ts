import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "../../src/types.js";
import {
  buildAccount,
  buildMessage,
  buildRuntimeEnv,
  createInboundCoreMock,
} from "./helpers/inbound.js";

const core = createInboundCoreMock({ handleTextCommands: true, hasControlCommand: true });

vi.mock("../../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
}));

import { handleGroupMeInbound } from "../../src/inbound.js";

describe("handleGroupMeInbound command bypass security", () => {
  beforeEach(() => {
    for (const fn of Object.values(core.fns)) {
      fn.mockClear();
    }
  });

  it("blocks command bypass when allowFrom is empty and requireAllowFrom is true", async () => {
    await handleGroupMeInbound({
      message: buildMessage({ text: "/help" }),
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
      runtime: buildRuntimeEnv(),
      groupHistories: new Map(),
      historyLimit: 20,
    });

    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("allows command bypass when explicitly configured", async () => {
    await handleGroupMeInbound({
      message: buildMessage({ text: "/help" }),
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
      runtime: buildRuntimeEnv(),
      groupHistories: new Map(),
      historyLimit: 20,
    });

    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
  });

  it("requires mention for commands in strict mode", async () => {
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
      runtime: buildRuntimeEnv(),
      groupHistories,
      historyLimit: 20,
    });

    expect(core.fns.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toHaveLength(1);
  });
});
