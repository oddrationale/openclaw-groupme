import { describe, expect, it } from "vitest";
import {
  buildGroupMeHistoryEntry,
  DEFAULT_GROUPME_HISTORY_LIMIT,
  formatGroupMeHistoryEntry,
  resolveGroupMeBodyForAgent,
  resolveGroupMeHistoryLimit,
} from "./history.js";

describe("resolveGroupMeHistoryLimit", () => {
  it("uses default when unset", () => {
    expect(resolveGroupMeHistoryLimit(undefined)).toBe(
      DEFAULT_GROUPME_HISTORY_LIMIT,
    );
  });

  it("normalizes positive finite values to integers", () => {
    expect(resolveGroupMeHistoryLimit(30.9)).toBe(30);
  });

  it("accepts zero to disable buffering", () => {
    expect(resolveGroupMeHistoryLimit(0)).toBe(0);
  });
});

describe("resolveGroupMeBodyForAgent", () => {
  it("prefers trimmed text when present", () => {
    expect(
      resolveGroupMeBodyForAgent({
        rawBody: "  hello  ",
        imageUrls: ["https://x"],
      }),
    ).toBe("hello");
  });

  it("falls back to image labels for image-only messages", () => {
    expect(
      resolveGroupMeBodyForAgent({
        rawBody: " ",
        imageUrls: ["https://i.groupme.com/one", "https://i.groupme.com/two"],
      }),
    ).toBe(
      "Image: https://i.groupme.com/one\nImage: https://i.groupme.com/two",
    );
  });
});

describe("buildGroupMeHistoryEntry", () => {
  it("returns a shaped history entry for non-empty body", () => {
    expect(
      buildGroupMeHistoryEntry({
        senderName: "Alice",
        body: "hello",
        timestamp: 1_700_000_000_000,
        messageId: "msg-1",
      }),
    ).toEqual({
      sender: "Alice",
      body: "hello",
      timestamp: 1_700_000_000_000,
      messageId: "msg-1",
    });
  });

  it("returns null for empty bodies", () => {
    expect(
      buildGroupMeHistoryEntry({
        senderName: "Alice",
        body: "   ",
        timestamp: 1,
        messageId: "msg-1",
      }),
    ).toBeNull();
  });
});

describe("formatGroupMeHistoryEntry", () => {
  it("formats sender-prefixed line", () => {
    expect(formatGroupMeHistoryEntry({ sender: "Bob", body: "hey" })).toBe(
      "Bob: hey",
    );
  });
});
