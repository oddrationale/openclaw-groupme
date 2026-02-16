import { describe, expect, it } from "vitest";
import {
  looksLikeGroupMeTargetId,
  normalizeGroupMeAllowEntry,
  normalizeGroupMeTarget,
  normalizeStringId,
} from "../src/normalize.js";

describe("groupme normalize", () => {
  it("normalizes string ids", () => {
    expect(normalizeStringId(" 123 ")).toBe("123");
    expect(normalizeStringId(456)).toBe("456");
  });

  it("returns undefined for empty IDs", () => {
    expect(normalizeStringId("   ")).toBeUndefined();
    expect(normalizeStringId("")).toBeUndefined();
  });

  it("normalizes prefixed targets", () => {
    expect(normalizeGroupMeTarget("groupme:group:12345")).toBe("12345");
    expect(normalizeGroupMeTarget("groupme:user:54321")).toBe("54321");
    expect(normalizeGroupMeTarget("group:abc")).toBe("abc");
    expect(normalizeGroupMeTarget("12345")).toBe("12345");
  });

  it("returns undefined for empty target", () => {
    expect(normalizeGroupMeTarget("  ")).toBeUndefined();
  });

  it("normalizes allow entries and keeps wildcard", () => {
    expect(normalizeGroupMeAllowEntry("groupme:user:123")).toBe("123");
    expect(normalizeGroupMeAllowEntry("*")).toBe("*");
  });

  it("validates likely target IDs", () => {
    expect(looksLikeGroupMeTargetId("groupme:group:123")).toBe(true);
    expect(looksLikeGroupMeTargetId("abc-123")).toBe(true);
    expect(looksLikeGroupMeTargetId("has spaces")).toBe(false);
    expect(looksLikeGroupMeTargetId(" ")).toBe(false);
  });
});
