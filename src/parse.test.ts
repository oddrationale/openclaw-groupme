import { describe, expect, it } from "vitest";
import {
  detectGroupMeMention,
  extractImageUrls,
  parseGroupMeCallback,
  shouldProcessCallback,
} from "./parse.js";

const validPayload = {
  id: "msg-1",
  text: "hello @oddclaw",
  name: "Alice",
  sender_type: "user",
  sender_id: "123",
  user_id: "123",
  group_id: "999",
  source_guid: "src-1",
  created_at: 1_700_000_000,
  system: false,
  avatar_url: "https://i.groupme.com/a.png",
  attachments: [{ type: "image", url: "https://i.groupme.com/img" }],
};

describe("parseGroupMeCallback", () => {
  it("parses a valid callback payload", () => {
    const parsed = parseGroupMeCallback(validPayload);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("msg-1");
    expect(parsed?.senderType).toBe("user");
    expect(parsed?.attachments).toHaveLength(1);
  });

  it("returns null for invalid payload", () => {
    expect(parseGroupMeCallback(null)).toBeNull();
    expect(parseGroupMeCallback({})).toBeNull();
    expect(
      parseGroupMeCallback({
        ...validPayload,
        sender_id: null,
      }),
    ).toBeNull();
  });

  it("handles missing text field by normalizing to empty string", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      text: null,
    });
    expect(parsed?.text).toBe("");
  });

  it("extracts image URLs from attachments", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      attachments: [
        { type: "image", url: "https://i.groupme.com/one" },
        { type: "emoji", placeholder: "x", charmap: [[1, 2]] },
        { type: "image", url: "https://i.groupme.com/two" },
      ],
    });
    expect(extractImageUrls(parsed?.attachments ?? [])).toEqual([
      "https://i.groupme.com/one",
      "https://i.groupme.com/two",
    ]);
  });
});

describe("shouldProcessCallback", () => {
  it("accepts user messages", () => {
    const parsed = parseGroupMeCallback(validPayload);
    expect(parsed).not.toBeNull();
    expect(shouldProcessCallback(parsed!)).toBeNull();
  });

  it("rejects bot messages", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      sender_type: "bot",
    });
    expect(parsed).not.toBeNull();
    expect(shouldProcessCallback(parsed!)).toBe("non-user message");
  });

  it("rejects system messages", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      system: true,
    });
    expect(parsed).not.toBeNull();
    expect(shouldProcessCallback(parsed!)).toBe("system message");
  });

  it("rejects empty messages with no attachments", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      text: "  ",
      attachments: [],
    });
    expect(parsed).not.toBeNull();
    expect(shouldProcessCallback(parsed!)).toBe("empty message");
  });

  it("accepts image-only messages", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      text: "",
      attachments: [{ type: "image", url: "https://i.groupme.com/only" }],
    });
    expect(parsed).not.toBeNull();
    expect(shouldProcessCallback(parsed!)).toBeNull();
  });
});

describe("detectGroupMeMention", () => {
  it("detects exact bot name mention", () => {
    expect(detectGroupMeMention({ text: "oddclaw help", botName: "oddclaw" })).toBe(true);
  });

  it("detects @botname mention", () => {
    expect(detectGroupMeMention({ text: "@oddclaw help", botName: "oddclaw" })).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectGroupMeMention({ text: "ODDCLAW", botName: "oddclaw" })).toBe(true);
  });

  it("uses mentionPatterns regex", () => {
    expect(
      detectGroupMeMention({
        text: "hey there",
        channelMentionPatterns: ["hey\\s+there"],
      }),
    ).toBe(true);
  });

  it("uses agent mention regexes", () => {
    expect(
      detectGroupMeMention({
        text: "Need oddclaw now",
        mentionRegexes: [/\boddclaw\b/i],
      }),
    ).toBe(true);
  });

  it("returns false for unrelated messages", () => {
    expect(detectGroupMeMention({ text: "random chat", botName: "oddclaw" })).toBe(false);
  });

  it("handles empty text", () => {
    expect(detectGroupMeMention({ text: "", botName: "oddclaw" })).toBe(false);
  });

  it("ignores invalid regex patterns", () => {
    expect(
      detectGroupMeMention({
        text: "oddclaw",
        botName: "oddclaw",
        channelMentionPatterns: ["[(invalid"],
      }),
    ).toBe(true);
  });
});
