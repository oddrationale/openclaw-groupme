import { createResolverContext } from "openclaw/plugin-sdk/security-runtime";
import { describe, expect, it } from "vitest";
import {
  channelSecrets,
  collectRuntimeConfigAssignments,
  secretTargetRegistryEntries,
} from "../src/secret-contract.js";

function envRef(name: string) {
  return { source: "env", provider: "default", id: name };
}

describe("GroupMe secret contract", () => {
  it("registers top-level and per-account secret targets for all secret fields", () => {
    expect(channelSecrets.secretTargetRegistryEntries).toBe(secretTargetRegistryEntries);
    expect(secretTargetRegistryEntries).toHaveLength(6);
    expect(secretTargetRegistryEntries.map((entry) => entry.id).toSorted()).toEqual([
      "channels.groupme.accessToken",
      "channels.groupme.accounts.*.accessToken",
      "channels.groupme.accounts.*.botId",
      "channels.groupme.accounts.*.callbackToken",
      "channels.groupme.botId",
      "channels.groupme.callbackToken",
    ]);

    for (const entry of secretTargetRegistryEntries) {
      expect(entry).toEqual(
        expect.objectContaining({
          configFile: "openclaw.json",
          secretShape: "secret_input",
          expectedResolvedValue: "string",
          includeInPlan: true,
          includeInConfigure: true,
          includeInAudit: true,
        }),
      );
      expect(entry.pathPattern).toBe(entry.id);
      expect(entry.targetType).toBe(entry.id);
    }
  });

  it("collects top-level assignments when the default account uses top-level fields", () => {
    const config = {
      channels: {
        groupme: {
          botId: envRef("GROUPME_BOT_ID"),
          accessToken: envRef("GROUPME_ACCESS_TOKEN"),
          callbackToken: "plain-callback-token",
        },
      },
    };
    const context = createResolverContext({
      sourceConfig: config,
      env: {},
    });

    collectRuntimeConfigAssignments({
      config,
      context,
    });

    expect(context.assignments.map((assignment) => assignment.path).toSorted()).toEqual([
      "channels.groupme.accessToken",
      "channels.groupme.botId",
    ]);
    expect(context.warnings).toEqual([]);
  });

  it("collects assignments for active account SecretRefs", () => {
    const config = {
      channels: {
        groupme: {
          botId: envRef("GROUPME_BOT_ID"),
          accessToken: envRef("GROUPME_ACCESS_TOKEN"),
          callbackToken: "plain-callback-token",
          accounts: {
            work: {
              botId: envRef("GROUPME_WORK_BOT_ID"),
              accessToken: envRef("GROUPME_WORK_ACCESS_TOKEN"),
              callbackToken: envRef("GROUPME_WORK_CALLBACK_TOKEN"),
            },
            disabled: {
              enabled: false,
              botId: envRef("GROUPME_DISABLED_BOT_ID"),
            },
          },
        },
      },
    };
    const context = createResolverContext({
      sourceConfig: config,
      env: {},
    });

    collectRuntimeConfigAssignments({
      config,
      context,
    });

    expect(context.assignments.map((assignment) => assignment.path).toSorted()).toEqual([
      "channels.groupme.accounts.work.accessToken",
      "channels.groupme.accounts.work.botId",
      "channels.groupme.accounts.work.callbackToken",
    ]);
    expect(context.warnings).toEqual([
      expect.objectContaining({
        code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
        path: "channels.groupme.botId",
      }),
      expect.objectContaining({
        code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
        path: "channels.groupme.accounts.disabled.botId",
      }),
      expect.objectContaining({
        code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
        path: "channels.groupme.accessToken",
      }),
    ]);
  });

  it("does nothing when the GroupMe channel is absent", () => {
    const config = { channels: {} };
    const context = createResolverContext({
      sourceConfig: config,
      env: {},
    });

    collectRuntimeConfigAssignments({ config, context });

    expect(context.assignments).toEqual([]);
    expect(context.warnings).toEqual([]);
  });
});
