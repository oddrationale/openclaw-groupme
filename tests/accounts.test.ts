import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  listGroupMeAccountIds,
  readTrimmed,
  resolveDefaultGroupMeAccountId,
  resolveGroupMeAccount,
} from "../src/accounts.js";
import type { CoreConfig, GroupMeConfig } from "../src/types.js";

function cfg(groupme: GroupMeConfig): CoreConfig {
  return { channels: { groupme } } as CoreConfig;
}

const ORIGINAL_GROUPME_BOT_ID = process.env.GROUPME_BOT_ID;

afterEach(() => {
  if (ORIGINAL_GROUPME_BOT_ID === undefined) {
    delete process.env.GROUPME_BOT_ID;
  } else {
    process.env.GROUPME_BOT_ID = ORIGINAL_GROUPME_BOT_ID;
  }
});

describe("resolveGroupMeAccount", () => {
  it("trims strings and rejects non-string secret values", () => {
    expect(readTrimmed(" token ")).toBe("token");
    expect(readTrimmed("   ")).toBeUndefined();
    expect(readTrimmed(123)).toBeUndefined();
  });

  it("lists normalized account ids with default first", () => {
    expect(
      listGroupMeAccountIds(
        cfg({
          accounts: {
            Work: { botId: "bot-work" },
            default: { botId: "bot-default" },
            " personal ": { botId: "bot-personal" },
          },
        }),
      ),
    ).toEqual(["default", "personal", "work"]);
  });

  it("resolves trimmed configured default account ids", () => {
    expect(resolveDefaultGroupMeAccountId(cfg({ defaultAccount: " Work " }))).toBe("work");
  });

  it("resolves the default account from explicit config", () => {
    const account = resolveGroupMeAccount({
      cfg: cfg({
        botId: "bot-1",
        accessToken: "token-1",
        callbackToken: "callback-secret",
        groupId: "group-1",
        webhookPath: "/groupme/hook",
      }),
      accountId: DEFAULT_ACCOUNT_ID,
    });

    expect(account.configured).toBe(true);
    expect(account.botId).toBe("bot-1");
    expect(account.accessToken).toBe("token-1");
    expect(account.config.callbackToken).toBe("callback-secret");
    expect(account.config.groupId).toBe("group-1");
    expect(account.config.webhookPath).toBe("/groupme/hook");
  });

  it("merges named accounts over top-level defaults", () => {
    const account = resolveGroupMeAccount({
      cfg: cfg({
        botName: "openclaw",
        webhookPath: "/groupme/base",
        accounts: {
          work: {
            botId: "bot-work",
            accessToken: "token-work",
            callbackToken: "callback-work",
            groupId: "group-work",
          },
        },
      }),
      accountId: "work",
    });

    expect(account.accountId).toBe("work");
    expect(account.config.botName).toBe("openclaw");
    expect(account.config.webhookPath).toBe("/groupme/base");
    expect(account.botId).toBe("bot-work");
    expect(account.accessToken).toBe("token-work");
    expect(account.config.callbackToken).toBe("callback-work");
  });

  it("falls back to normalized matching account keys", () => {
    const account = resolveGroupMeAccount({
      cfg: cfg({
        accounts: {
          "Work Bot": {
            botId: "bot-work",
            enabled: false,
          },
        },
      }),
      accountId: "work-bot",
    });

    expect(account.accountId).toBe("work-bot");
    expect(account.botId).toBe("bot-work");
    expect(account.enabled).toBe(false);
  });

  it("disables named accounts when the top-level channel is disabled", () => {
    const account = resolveGroupMeAccount({
      cfg: cfg({
        enabled: false,
        accounts: {
          work: {
            botId: "bot-work",
            enabled: true,
          },
        },
      }),
      accountId: "work",
    });

    expect(account.enabled).toBe(false);
    expect(account.configured).toBe(true);
  });

  it("does not read process env as implicit configuration", () => {
    process.env.GROUPME_BOT_ID = "env-bot";

    const account = resolveGroupMeAccount({
      cfg: { channels: {} } as CoreConfig,
      accountId: DEFAULT_ACCOUNT_ID,
    });

    expect(account.configured).toBe(false);
    expect(account.botId).toBe("");
  });
});
