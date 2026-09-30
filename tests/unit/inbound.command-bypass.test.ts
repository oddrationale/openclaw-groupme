import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig, GroupMeAccountConfig } from "../../src/types.js";
import {
  buildAccount,
  buildMessage,
  buildRuntimeEnv,
  createInboundCoreMock,
  lastContext,
} from "./helpers/inbound.js";

const core = createInboundCoreMock({ handleTextCommands: true, hasControlCommand: true });

vi.mock("../../src/runtime.js", () => ({
  getGroupMeRuntime: () => core.runtime,
  tryGetGroupMeRuntime: () => core.runtime,
}));

import { handleGroupMeInbound } from "../../src/inbound.js";

async function runCommand(params: {
  config: GroupMeAccountConfig;
  text?: string;
  senderId?: string;
  groupHistories?: Map<string, unknown[]>;
}) {
  const runtime = buildRuntimeEnv();
  const groupHistories = (params.groupHistories ?? new Map()) as Parameters<
    typeof handleGroupMeInbound
  >[0]["groupHistories"];
  await handleGroupMeInbound({
    message: buildMessage({ text: params.text ?? "/help", senderId: params.senderId ?? "user-1" }),
    account: buildAccount({ config: { botName: "oddclaw", ...params.config } }),
    config: {} as CoreConfig,
    runtime,
    groupHistories,
    historyLimit: 20,
  });
  return { runtime, groupHistories };
}

describe("handleGroupMeInbound command bypass security", () => {
  beforeEach(() => {
    for (const fn of Object.values(core.fns)) {
      fn.mockClear();
    }
    core.fns.shouldHandleTextCommands.mockReturnValue(true);
    core.fns.hasControlCommand.mockReturnValue(true);
  });

  it("blocks command bypass when allowFrom is empty and requireAllowFrom is true", async () => {
    const { runtime, groupHistories } = await runCommand({
      config: {
        requireMention: true,
        security: {
          commandBypass: { requireAllowFrom: true, requireMentionForCommands: false },
        },
      },
    });

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(groupHistories.size).toBe(0);
    expect(runtime.log).toHaveBeenCalledWith(
      "groupme: drop control command (unauthorized) target=user-1",
    );
  });

  it("allows command bypass for any member when requireAllowFrom is false", async () => {
    await runCommand({
      config: {
        requireMention: true,
        security: {
          commandBypass: { requireAllowFrom: false, requireMentionForCommands: false },
        },
      },
    });

    expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    expect(lastContext(core)).toEqual(
      expect.objectContaining({
        CommandAuthorized: true,
        // An authorized command activates the bot without an explicit mention.
        WasMentioned: true,
        CommandBody: "/help",
      }),
    );
    const ingress = core.fns.resolveStable.mock.calls[0]?.[0];
    expect(ingress?.command).toEqual(
      expect.objectContaining({ useAccessGroups: false, modeWhenAccessGroupsOff: "allow" }),
    );
  });

  it("lets an allowlisted sender run commands without a mention", async () => {
    await runCommand({
      config: { requireMention: true, allowFrom: ["groupme:user:user-1"] },
    });

    expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    expect(lastContext(core)).toEqual(
      expect.objectContaining({ CommandAuthorized: true, WasMentioned: true }),
    );
  });

  it('treats "*" as admitting everyone and authorizing their commands', async () => {
    await runCommand({
      config: { requireMention: true, allowFrom: ["*"] },
      senderId: "anyone",
    });

    expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    expect(lastContext(core)).toEqual(expect.objectContaining({ CommandAuthorized: true }));
  });

  it("drops commands from senders outside a non-empty allowFrom", async () => {
    const { runtime } = await runCommand({
      config: { requireMention: false, allowFrom: ["user-2"] },
    });

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith("groupme: drop sender user-1 (not in allowFrom)");
  });

  it("requires mention for commands in strict mode", async () => {
    const { groupHistories } = await runCommand({
      text: "/status",
      config: {
        requireMention: true,
        allowFrom: ["user-1"],
        security: {
          commandBypass: { requireAllowFrom: true, requireMentionForCommands: true },
        },
      },
    });

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toHaveLength(1);
    const ingress = core.fns.resolveStable.mock.calls[0]?.[0];
    expect(ingress?.policy?.activation?.allowTextCommands).toBe(false);
  });

  it("dispatches a mentioned command in strict mode", async () => {
    await runCommand({
      text: "@oddclaw /status",
      config: {
        requireMention: true,
        allowFrom: ["user-1"],
        security: {
          commandBypass: { requireAllowFrom: true, requireMentionForCommands: true },
        },
      },
    });

    expect(core.fns.dispatch).toHaveBeenCalledTimes(1);
    expect(lastContext(core)).toEqual(
      expect.objectContaining({ CommandAuthorized: true, WasMentioned: true }),
    );
  });

  it("does not treat commands as activation when text commands are disabled", async () => {
    core.fns.shouldHandleTextCommands.mockReturnValue(false);

    const { groupHistories } = await runCommand({
      config: { requireMention: true, allowFrom: ["user-1"] },
    });

    expect(core.fns.dispatch).not.toHaveBeenCalled();
    expect(groupHistories.get("group-1")).toHaveLength(1);
  });

  it("maps GroupMe settings onto the core ingress request", async () => {
    await runCommand({
      config: { requireMention: false, allowFrom: [" groupme:user:user-1 ", 42, ""] },
    });

    const ingress = core.fns.resolveStable.mock.calls[0]?.[0];
    expect(ingress).toEqual(
      expect.objectContaining({
        channelId: "groupme",
        accountId: "default",
        subject: { stableId: "user-1" },
        conversation: { kind: "group", id: "group-1" },
        groupPolicy: "allowlist",
        groupAllowFrom: ["user-1", "42"],
      }),
    );
    expect(ingress?.identity?.normalize?.("groupme:user:abc")).toBe("abc");
    expect(ingress?.identity?.normalize?.("   ")).toBeNull();
  });
});
