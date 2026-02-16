import { describe, expect, it } from "vitest";
import {
  checkGroupBinding,
  redactCallbackUrl,
  resolveGroupMeSecurity,
  validateProxyRequest,
  verifyCallbackAuth,
} from "../src/security.js";
import type { GroupMeAccountConfig } from "../src/types.js";

function buildSecurity(config?: GroupMeAccountConfig) {
  return resolveGroupMeSecurity(config ?? {});
}

describe("verifyCallbackAuth", () => {
  it("accepts active token", () => {
    const security = buildSecurity({
      callbackUrl: "/groupme/abc?k=active",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=active"),
      security,
    });
    expect(result).toEqual({ ok: true, tokenId: "active" });
  });

  it("rejects missing token", () => {
    const security = buildSecurity({
      callbackUrl: "/groupme/abc?k=active",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects mismatched token", () => {
    const security = buildSecurity({
      callbackUrl: "/groupme/abc?k=active",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=bad"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("treats callback auth as disabled when callbackUrl token is missing", () => {
    const security = buildSecurity({
      callbackUrl: "/groupme/abc",
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=anything"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "disabled" });
  });
});

describe("checkGroupBinding", () => {
  it("treats binding as disabled when expected group id is not configured", () => {
    const security = buildSecurity({});
    expect(
      checkGroupBinding({
        expectedGroupId: security.expectedGroupId,
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: true });
  });

  it("accepts expected group", () => {
    expect(
      checkGroupBinding({
        expectedGroupId: "123",
        inboundGroupId: "123",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects mismatch", () => {
    expect(
      checkGroupBinding({
        expectedGroupId: "123",
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("accepts when expected group id is missing", () => {
    expect(
      checkGroupBinding({
        expectedGroupId: "",
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: true });
  });
});

describe("redactCallbackUrl", () => {
  it("redacts callback token in query", () => {
    const security = buildSecurity({
      callbackUrl: "/groupme/abc?k=active-token",
    });

    const redacted = redactCallbackUrl(
      "/groupme/abc?k=active-token",
      security,
    );

    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("active-token");
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
          enabled: true,
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

  it("rejects disallowed public hosts when proxy policy is enabled", () => {
    const security = buildSecurity({
      security: {
        proxy: {
          enabled: true,
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
          enabled: true,
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
