import { describe, expect, it } from "vitest";
import { resolveSenderAccess } from "./policy.js";

describe("resolveSenderAccess", () => {
  it("allows all when allowFrom is empty", () => {
    expect(resolveSenderAccess({ senderId: "123", allowFrom: [] })).toBe(true);
    expect(resolveSenderAccess({ senderId: "123" })).toBe(true);
  });

  it("allows wildcard", () => {
    expect(resolveSenderAccess({ senderId: "123", allowFrom: ["*"] })).toBe(true);
  });

  it("allows listed sender", () => {
    expect(resolveSenderAccess({ senderId: "123", allowFrom: ["123"] })).toBe(true);
    expect(resolveSenderAccess({ senderId: "123", allowFrom: [123] })).toBe(true);
    expect(resolveSenderAccess({ senderId: "123", allowFrom: ["groupme:user:123"] })).toBe(true);
  });

  it("blocks unlisted sender", () => {
    expect(resolveSenderAccess({ senderId: "999", allowFrom: ["123", "456"] })).toBe(false);
  });
});
