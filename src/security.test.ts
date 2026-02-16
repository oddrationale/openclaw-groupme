import { describe, expect, it } from "vitest";
import {
  checkGroupBinding,
  redactCallbackUrl,
  resolveGroupMeSecurity,
  verifyCallbackAuth,
} from "./security.js";
import type { GroupMeAccountConfig } from "./types.js";

function buildSecurity(config?: GroupMeAccountConfig) {
  return resolveGroupMeSecurity(config ?? {});
}

describe("verifyCallbackAuth", () => {
  it("accepts active token", () => {
    const security = buildSecurity({
      security: {
        callbackAuth: { enabled: true, token: "active", queryKey: "k" },
      },
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=active"),
      security,
    });
    expect(result).toEqual({ ok: true, tokenId: "active" });
  });

  it("accepts previous token", () => {
    const security = buildSecurity({
      security: {
        callbackAuth: {
          enabled: true,
          token: "active",
          previousTokens: ["old"],
          queryKey: "k",
        },
      },
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=old"),
      security,
    });
    expect(result).toEqual({ ok: true, tokenId: "previous" });
  });

  it("rejects missing token", () => {
    const security = buildSecurity({
      security: {
        callbackAuth: { enabled: true, token: "active", queryKey: "k" },
      },
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects mismatched token", () => {
    const security = buildSecurity({
      security: {
        callbackAuth: { enabled: true, token: "active", queryKey: "k" },
      },
    });
    const result = verifyCallbackAuth({
      url: new URL("http://localhost/groupme?k=bad"),
      security,
    });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("checkGroupBinding", () => {
  it("accepts expected group", () => {
    expect(
      checkGroupBinding({
        enabled: true,
        expectedGroupId: "123",
        inboundGroupId: "123",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects mismatch", () => {
    expect(
      checkGroupBinding({
        enabled: true,
        expectedGroupId: "123",
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects missing expected group when binding is enabled", () => {
    expect(
      checkGroupBinding({
        enabled: true,
        expectedGroupId: "",
        inboundGroupId: "456",
      }),
    ).toEqual({ ok: false, reason: "missing" });
  });
});

describe("redactCallbackUrl", () => {
  it("redacts callback secrets in query and path", () => {
    const security = buildSecurity({
      security: {
        callbackAuth: {
          enabled: true,
          token: "active-token",
          previousTokens: ["old-token"],
          tokenLocation: "either",
          queryKey: "k",
        },
      },
    });

    const redacted = redactCallbackUrl(
      "/groupme/active-token?k=old-token",
      security,
    );

    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("active-token");
    expect(redacted).not.toContain("old-token");
  });
});
