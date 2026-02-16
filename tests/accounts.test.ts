import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGroupMeAccount } from "../src/accounts.js";
import type { CoreConfig } from "../src/types.js";

function emptyCfg(): CoreConfig {
  return { channels: {} } as CoreConfig;
}

const ENV_CALLBACK_URL = "GROUPME_CALLBACK_URL";
const ENV_GROUP_ID = "GROUPME_GROUP_ID";
const ENV_PUBLIC_DOMAIN = "GROUPME_PUBLIC_DOMAIN";

const ORIGINAL_CALLBACK_URL = process.env[ENV_CALLBACK_URL];
const ORIGINAL_GROUP_ID = process.env[ENV_GROUP_ID];
const ORIGINAL_PUBLIC_DOMAIN = process.env[ENV_PUBLIC_DOMAIN];

afterEach(() => {
  if (ORIGINAL_CALLBACK_URL === undefined) {
    delete process.env[ENV_CALLBACK_URL];
  } else {
    process.env[ENV_CALLBACK_URL] = ORIGINAL_CALLBACK_URL;
  }
  if (ORIGINAL_GROUP_ID === undefined) {
    delete process.env[ENV_GROUP_ID];
  } else {
    process.env[ENV_GROUP_ID] = ORIGINAL_GROUP_ID;
  }
  if (ORIGINAL_PUBLIC_DOMAIN === undefined) {
    delete process.env[ENV_PUBLIC_DOMAIN];
  } else {
    process.env[ENV_PUBLIC_DOMAIN] = ORIGINAL_PUBLIC_DOMAIN;
  }
});

describe("resolveGroupMeAccount env fallbacks", () => {
  it("reads callbackUrl from GROUPME_CALLBACK_URL for default account", () => {
    process.env[ENV_CALLBACK_URL] = "/groupme/env?k=env-token";
    delete process.env[ENV_GROUP_ID];

    const account = resolveGroupMeAccount({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
    });

    expect(account.config.callbackUrl).toBe("/groupme/env?k=env-token");
  });

  it("reads groupId from GROUPME_GROUP_ID for default account", () => {
    process.env[ENV_GROUP_ID] = "123456";
    delete process.env[ENV_CALLBACK_URL];
    delete process.env[ENV_PUBLIC_DOMAIN];

    const account = resolveGroupMeAccount({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
    });

    expect(account.config.groupId).toBe("123456");
  });

  it("reads publicDomain from GROUPME_PUBLIC_DOMAIN for default account", () => {
    process.env[ENV_PUBLIC_DOMAIN] = "bot.example.com";
    delete process.env[ENV_CALLBACK_URL];
    delete process.env[ENV_GROUP_ID];

    const account = resolveGroupMeAccount({
      cfg: emptyCfg(),
      accountId: DEFAULT_ACCOUNT_ID,
    });

    expect(account.config.publicDomain).toBe("bot.example.com");
  });

  it("does not use env fallback for named account", () => {
    process.env[ENV_CALLBACK_URL] = "/groupme/env?k=env-token";
    process.env[ENV_GROUP_ID] = "123456";
    process.env[ENV_PUBLIC_DOMAIN] = "bot.example.com";

    const account = resolveGroupMeAccount({
      cfg: emptyCfg(),
      accountId: "work",
    });

    expect(account.config.callbackUrl).toBeUndefined();
    expect(account.config.groupId).toBeUndefined();
    expect(account.config.publicDomain).toBeUndefined();
  });
});
