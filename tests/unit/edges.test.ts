import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import {
  listGroupMeAccountIds,
  resolveDefaultGroupMeAccountId,
  resolveGroupMeAccount,
} from "../../src/accounts.js";
import { looksLikeGroupMeTargetId, normalizeGroupMeTarget } from "../../src/normalize.js";
import { parseGroupMeCallback } from "../../src/parse.js";
import {
  redactWebhookUrl,
  resolveGroupMeSecurity,
  validateProxyRequest,
} from "../../src/security.js";
import type { CoreConfig, GroupMeConfig } from "../../src/types.js";

function cfg(groupme: GroupMeConfig): CoreConfig {
  return { channels: { groupme } } as CoreConfig;
}

describe("normalize edge cases", () => {
  it("returns undefined when only a prefix is supplied", () => {
    expect(normalizeGroupMeTarget("groupme:user:")).toBeUndefined();
  });

  it("treats the wildcard as not a concrete target id", () => {
    expect(looksLikeGroupMeTargetId("*")).toBe(false);
    expect(looksLikeGroupMeTargetId("groupme:user:*")).toBe(false);
  });
});

describe("accounts edge cases", () => {
  it("falls back to the default account id when no default is configured", () => {
    expect(resolveDefaultGroupMeAccountId(cfg({}))).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("resolves the default account when no accountId is requested", () => {
    const account = resolveGroupMeAccount({ cfg: cfg({ botId: "bot-x" }) });
    expect(account.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(account.botId).toBe("bot-x");
  });

  it("ignores blank account keys when listing account ids", () => {
    expect(listGroupMeAccountIds(cfg({ accounts: { "   ": { botId: "blank" } } }))).toEqual([
      DEFAULT_ACCOUNT_ID,
    ]);
  });

  it("returns only base config when a requested named account does not exist", () => {
    const account = resolveGroupMeAccount({
      cfg: cfg({ botName: "base", accounts: { work: { botId: "work-bot" } } }),
      accountId: "missing",
    });
    expect(account.accountId).toBe("missing");
    expect(account.config.botName).toBe("base");
    expect(account.botId).toBe("");
  });
});

describe("parse edge cases", () => {
  const base = {
    id: "msg-1",
    text: "hi",
    name: "Alice",
    sender_type: "user",
    sender_id: "123",
    user_id: "123",
    group_id: "999",
    source_guid: "src-1",
    created_at: 1_700_000_000,
  };

  it("treats a non-array attachments field as empty", () => {
    const parsed = parseGroupMeCallback({ ...base, attachments: "nope" });
    expect(parsed?.attachments).toEqual([]);
  });

  it("coerces non-array mention fields to empty arrays", () => {
    const parsed = parseGroupMeCallback({
      ...base,
      attachments: [{ type: "mentions", user_ids: "x", loci: "y" }],
    });
    expect(parsed?.attachments).toEqual([{ type: "mentions", user_ids: [], loci: [] }]);
  });
});

describe("security proxy matcher edge cases", () => {
  it("matches plain and CIDR trusted proxies across IPv4/IPv6 and skips malformed entries", () => {
    const security = resolveGroupMeSecurity({
      security: {
        proxy: {
          trustedProxyCidrs: [
            "203.0.113.5",
            "2001:db8::1",
            "10.0.0.0/8",
            "2001:db8::/32",
            "bad/24",
            "10.0.0.0/999",
          ],
        },
      },
    });

    expect(security.proxy.isTrustedProxy("203.0.113.5")).toBe(true);
    expect(security.proxy.isTrustedProxy("2001:db8::1")).toBe(true);
    expect(security.proxy.isTrustedProxy("10.1.2.3")).toBe(true);
    expect(security.proxy.isTrustedProxy("2001:db8::abcd")).toBe(true);
    expect(security.proxy.isTrustedProxy("2001:db8::1%eth0")).toBe(true);
    expect(security.proxy.isTrustedProxy("198.51.100.9")).toBe(false);
    expect(security.proxy.isTrustedProxy("2001:dead::1")).toBe(false);
  });

  it("never trusts any ip when no proxy cidrs are configured", () => {
    const security = resolveGroupMeSecurity({ security: { proxy: { trustedProxyCidrs: [] } } });
    expect(security.proxy.isTrustedProxy("203.0.113.5")).toBe(false);
  });

  it("normalizes malformed and edge-case proxy entries defensively", () => {
    const security = resolveGroupMeSecurity({
      security: {
        proxy: {
          // bracket-without-close and a bad IPv4-mapped address are dropped; an
          // IPv4:port entry is reduced to the bare IPv4.
          trustedProxyCidrs: ["[", "::ffff:not-an-ip", "203.0.113.5:8080"],
          allowedPublicHosts: [""],
        },
      },
    });
    expect(security.proxy.isTrustedProxy("203.0.113.5")).toBe(true);
    expect(security.proxy.isTrustedProxy("198.51.100.1")).toBe(false);
    expect(security.proxy.allowedPublicHosts).toEqual([]);
  });

  it("falls back to 'unknown' for an unparseable remote address", () => {
    const security = resolveGroupMeSecurity({});
    const result = validateProxyRequest({
      headers: {},
      remoteAddress: "garbage",
      socketEncrypted: false,
      security,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected proxy validation success");
    }
    expect(result.context.remoteIp).toBe("unknown");
  });

  it("drops malformed hosts from the allowlist", () => {
    const security = resolveGroupMeSecurity({
      security: { proxy: { allowedPublicHosts: ["[", "bot.example.com"] } },
    });
    expect(security.proxy.allowedPublicHosts).toEqual(["bot.example.com"]);
  });

  it("rejects a comma-only host as missing", () => {
    const security = resolveGroupMeSecurity({
      security: { proxy: { allowedPublicHosts: ["bot.example.com"] } },
    });
    const result = validateProxyRequest({
      headers: { host: "," },
      remoteAddress: "127.0.0.1",
      socketEncrypted: false,
      security,
    });
    expect(result).toEqual({ ok: false, reason: "missing_host", status: 403 });
  });

  it("redacts the callback token even when the url cannot be parsed", () => {
    const security = resolveGroupMeSecurity({ callbackToken: "supersecret" });
    const redacted = redactWebhookUrl("http://[bad?k=supersecret", security);
    expect(redacted).not.toContain("supersecret");
    expect(redacted).toContain("[redacted]");
  });
});
