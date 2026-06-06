import { describe, expect, it } from "vitest";
import {
  checkGroupBinding,
  redactWebhookUrl,
  resolveGroupMeSecurity,
  validateProxyRequest,
  verifyCallbackAuth,
} from "../../src/security.js";
import type { GroupMeAccountConfig } from "../../src/types.js";

function buildSecurity(config?: GroupMeAccountConfig) {
  return resolveGroupMeSecurity(config ?? {});
}

describe("verifyCallbackAuth", () => {
  it("accepts active token", () => {
    const security = buildSecurity({
      callbackToken: "active",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=active"),
      security,
    });
    expect(result).toEqual({ ok: true, tokenId: "active" });
  });

  it("rejects missing token", () => {
    const security = buildSecurity({
      callbackToken: "active",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects mismatched token", () => {
    const security = buildSecurity({
      callbackToken: "active",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=bad"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects token with different length", () => {
    const security = buildSecurity({
      callbackToken: "active",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=longer-token-value"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("treats callback auth as disabled when callbackToken is missing", () => {
    const security = buildSecurity({});
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=anything"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "disabled" });
  });
});

describe("checkGroupBinding", () => {
  it("rejects when group id is not configured", () => {
    const security = buildSecurity({});
    expect(
      checkGroupBinding({
        groupId: security.groupId,
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("accepts matching group", () => {
    expect(
      checkGroupBinding({
        groupId: "123",
        inboundGroupId: "123",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects mismatch", () => {
    expect(
      checkGroupBinding({
        groupId: "123",
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects when group id is empty", () => {
    expect(
      checkGroupBinding({
        groupId: "",
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("redactWebhookUrl", () => {
  it("redacts callback token in query", () => {
    const security = buildSecurity({
      callbackToken: "active-token",
    });

    const redacted = redactWebhookUrl("/groupme/abc?k=active-token", security);

    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("active-token");
  });

  it("returns the raw URL when callback auth is disabled", () => {
    const security = buildSecurity({});

    expect(redactWebhookUrl("/groupme?k=plain", security)).toBe("/groupme?k=plain");
  });
});

describe("resolveGroupMeSecurity", () => {
  it("normalizes invalid numeric config to secure defaults and filters string lists", () => {
    const security = buildSecurity({
      callbackToken: " secret ",
      groupId: " group-1 ",
      security: {
        replay: { ttlSeconds: -1, maxEntries: 0 },
        rateLimit: {
          windowMs: Number.NaN,
          maxRequestsPerIp: -1,
          maxRequestsPerSender: 0,
          maxConcurrent: 2.9,
        },
        media: {
          allowPrivateNetworks: true,
          maxDownloadBytes: 0,
          requestTimeoutMs: -1,
          allowedMimePrefixes: [" image/png ", "", "image/gif"],
        },
        logging: {
          redactSecrets: false,
          logRejectedRequests: false,
        },
        commandBypass: {
          requireAllowFrom: false,
          requireMentionForCommands: true,
        },
        proxy: {
          trustedProxyCidrs: [" 127.0.0.1/32 ", "", "not-an-ip", "2001:db8::1"],
          allowedPublicHosts: [" Bot.EXAMPLE.com:443 ", "bad@example.com", "[2001:db8::1]"],
          requireHttpsProto: true,
          rejectStatus: 404,
        },
      },
    });

    expect(security.callbackToken).toBe("secret");
    expect(security.groupId).toBe("group-1");
    expect(security.replay).toEqual({ enabled: true, ttlSeconds: 600, maxEntries: 10_000 });
    expect(security.rateLimit).toEqual({
      enabled: true,
      windowMs: 60_000,
      maxRequestsPerIp: 120,
      maxRequestsPerSender: 60,
      maxConcurrent: 2,
    });
    expect(security.media).toEqual({
      allowPrivateNetworks: true,
      maxDownloadBytes: 15 * 1024 * 1024,
      requestTimeoutMs: 10_000,
      allowedMimePrefixes: ["image/png", "image/gif"],
    });
    expect(security.logging).toEqual({ redactSecrets: false, logRejectedRequests: false });
    expect(security.commandBypass).toEqual({
      requireAllowFrom: false,
      requireMentionForCommands: true,
    });
    expect(security.proxy.trustedProxyCidrs).toEqual(["127.0.0.1/32", "not-an-ip", "2001:db8::1"]);
    expect(security.proxy.allowedPublicHosts).toEqual(["bot.example.com", "2001:db8::1"]);
    expect(security.proxy.rejectStatus).toBe(404);
    expect(security.proxy.isTrustedProxy("127.0.0.1:1234")).toBe(true);
    expect(security.proxy.isTrustedProxy("[2001:db8::1]")).toBe(true);
    expect(security.proxy.isTrustedProxy("")).toBe(false);
  });

  it("falls back to image MIME defaults when configured prefixes are empty", () => {
    const security = buildSecurity({
      security: {
        media: {
          allowedMimePrefixes: ["  "],
        },
      },
    });

    expect(security.media.allowedMimePrefixes).toEqual(["image/"]);
  });
});

describe("validateProxyRequest", () => {
  it("uses remote socket values when proxy security is disabled", () => {
    const security = buildSecurity();
    const result = validateProxyRequest({
      headers: {
        host: "local.example",
        "x-forwarded-for": "198.51.100.1",
        "x-forwarded-host": "forwarded.example",
      },
      remoteAddress: "127.0.0.1",
      socketEncrypted: false,
      security,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected proxy validation success");
    }
    expect(result.context.clientIp).toBe("127.0.0.1");
    expect(result.context.host).toBe("local.example");
    expect(result.context.proto).toBe("http");
    expect(result.context.usingForwardedHeaders).toBe(false);
  });

  it("trusts x-forwarded-* headers only from configured proxy CIDRs", () => {
    const security = buildSecurity({
      security: {
        proxy: {
          trustedProxyCidrs: ["127.0.0.1/32"],
          allowedPublicHosts: ["bot.example.com"],
          requireHttpsProto: true,
          rejectStatus: 403,
        },
      },
    });
    const result = validateProxyRequest({
      headers: {
        host: "internal.example",
        "x-forwarded-for": "198.51.100.25",
        "x-forwarded-host": "bot.example.com",
        "x-forwarded-proto": "https",
      },
      remoteAddress: "127.0.0.1",
      socketEncrypted: false,
      security,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected proxy validation success");
    }
    expect(result.context.clientIp).toBe("198.51.100.25");
    expect(result.context.host).toBe("bot.example.com");
    expect(result.context.proto).toBe("https");
    expect(result.context.usingForwardedHeaders).toBe(true);
  });

  it("handles array headers, forwarded chains, IPv4-mapped remotes, and invalid proto fallback", () => {
    const security = buildSecurity({
      security: {
        proxy: {
          trustedProxyCidrs: ["198.51.100.10/32"],
          allowedPublicHosts: ["bot.example.com"],
          rejectStatus: 403,
        },
      },
    });
    const result = validateProxyRequest({
      headers: {
        host: "internal.example",
        "x-forwarded-for": ["203.0.113.9, 10.0.0.1"],
        "x-forwarded-host": "bot.example.com, attacker.example",
        "x-forwarded-proto": "ftp, https",
      },
      remoteAddress: "::ffff:198.51.100.10",
      socketEncrypted: true,
      security,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected proxy validation success");
    }
    expect(result.context.remoteIp).toBe("198.51.100.10");
    expect(result.context.clientIp).toBe("203.0.113.9");
    expect(result.context.host).toBe("bot.example.com");
    expect(result.context.proto).toBe("https");
    expect(result.context.fromTrustedProxy).toBe(true);
    expect(result.context.usingForwardedHeaders).toBe(true);
  });

  it("ignores forwarded headers from untrusted proxies", () => {
    const security = buildSecurity({
      security: {
        proxy: {
          trustedProxyCidrs: ["127.0.0.1/32"],
          allowedPublicHosts: ["public.example.com"],
        },
      },
    });
    const result = validateProxyRequest({
      headers: {
        host: "public.example.com",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "http",
      },
      remoteAddress: "198.51.100.10",
      socketEncrypted: true,
      security,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected untrusted proxy request to use direct headers");
    }
    expect(result.context.host).toBe("public.example.com");
    expect(result.context.proto).toBe("https");
    expect(result.context.usingForwardedHeaders).toBe(false);
  });

  it("rejects missing effective host when proxy policy is enabled", () => {
    const security = buildSecurity({
      security: {
        proxy: {
          rejectStatus: 400,
        },
      },
    });
    const result = validateProxyRequest({
      headers: {},
      remoteAddress: "127.0.0.1",
      socketEncrypted: false,
      security,
    });

    expect(result).toEqual({
      ok: false,
      reason: "missing_host",
      status: 400,
    });
  });

  it("rejects disallowed public hosts when proxy policy is enabled", () => {
    const security = buildSecurity({
      security: {
        proxy: {
          trustedProxyCidrs: ["127.0.0.1/32"],
          allowedPublicHosts: ["bot.example.com"],
          rejectStatus: 403,
        },
      },
    });
    const result = validateProxyRequest({
      headers: {
        host: "internal.example",
        "x-forwarded-host": "attacker.example",
      },
      remoteAddress: "127.0.0.1",
      socketEncrypted: true,
      security,
    });
    expect(result).toEqual({
      ok: false,
      reason: "host_not_allowed",
      status: 403,
    });
  });

  it("enforces https proto when configured", () => {
    const security = buildSecurity({
      security: {
        proxy: {
          trustedProxyCidrs: ["127.0.0.1/32"],
          requireHttpsProto: true,
          rejectStatus: 400,
        },
      },
    });
    const result = validateProxyRequest({
      headers: {
        host: "bot.example.com",
        "x-forwarded-proto": "http",
      },
      remoteAddress: "127.0.0.1",
      socketEncrypted: false,
      security,
    });
    expect(result).toEqual({
      ok: false,
      reason: "proto_not_https",
      status: 400,
    });
  });
});
