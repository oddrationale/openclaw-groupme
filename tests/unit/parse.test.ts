import { describe, expect, it } from "vitest";
import {
  detectGroupMeMention,
  extractImageUrls,
  parseGroupMeCallback,
  shouldProcessCallback,
} from "../../src/parse.js";

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

function parseValidPayload(payload: unknown = validPayload) {
  const parsed = parseGroupMeCallback(payload);
  if (!parsed) {
    throw new Error("expected valid callback payload to parse");
  }
  return parsed;
}

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

  it("parses supported attachment variants and drops malformed entries", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      created_at: "1700000001",
      system: "not-a-boolean",
      avatar_url: "   ",
      attachments: [
        null,
        { type: "" },
        { type: "image", url: "   " },
        { type: "location", lat: "1", lng: "2", name: "Park" },
        { type: "mentions", user_ids: ["u1", "", 2], loci: [[0, "3"], ["bad"], 4] },
        { type: "emoji", placeholder: "😀", charmap: [[1, 2], ["x"]] },
        { type: "custom", value: 1 },
      ],
    });

    expect(parsed?.createdAt).toBe(1_700_000_001);
    expect(parsed?.system).toBe(false);
    expect(parsed?.avatarUrl).toBeNull();
    expect(parsed?.attachments).toEqual([
      { type: "location", lat: "1", lng: "2", name: "Park" },
      { type: "mentions", user_ids: ["u1"], loci: [[0, 3]] },
      { type: "emoji", placeholder: "😀", charmap: [[1, 2]] },
      { type: "custom", value: 1 },
    ]);
  });

  it("drops malformed structured attachments", () => {
    const parsed = parseGroupMeCallback({
      ...validPayload,
      attachments: [
        { type: "location", lat: "", lng: "2", name: "Park" },
        { type: "location", lat: "1", lng: "", name: "Park" },
        { type: "location", lat: "1", lng: "2", name: "" },
        { type: "emoji", placeholder: "" },
        { type: "mentions", user_ids: "u1", loci: "bad" },
      ],
    });

    expect(parsed?.attachments).toEqual([{ type: "mentions", user_ids: [], loci: [] }]);
  });

  it("rejects non-finite created_at values", () => {
    expect(parseGroupMeCallback({ ...validPayload, created_at: "nope" })).toBeNull();
    expect(parseGroupMeCallback({ ...validPayload, created_at: undefined })).toBeNull();
  });
});

describe("shouldProcessCallback", () => {
  it("accepts user messages", () => {
    expect(shouldProcessCallback(parseValidPayload())).toBeNull();
  });

  it("rejects bot messages", () => {
    expect(shouldProcessCallback(parseValidPayload({ ...validPayload, sender_type: "bot" }))).toBe(
      "non-user message",
    );
  });

  it("rejects system messages", () => {
    expect(shouldProcessCallback(parseValidPayload({ ...validPayload, system: true }))).toBe(
      "system message",
    );
  });

  it("rejects empty messages with no attachments", () => {
    expect(
      shouldProcessCallback(parseValidPayload({ ...validPayload, text: "  ", attachments: [] })),
    ).toBe("empty message");
  });

  it("accepts image-only messages", () => {
    expect(
      shouldProcessCallback(
        parseValidPayload({
          ...validPayload,
          text: "",
          attachments: [{ type: "image", url: "https://i.groupme.com/only" }],
        }),
      ),
    ).toBeNull();
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

  it("normalizes hidden unicode markers before agent mention matching", () => {
    expect(
      detectGroupMeMention({
        text: "Need odd\u200bclaw now",
        mentionRegexes: [/oddclaw/],
      }),
    ).toBe(true);
  });

  it("escapes bot names before building mention regexes", () => {
    expect(detectGroupMeMention({ text: "@bot.name", botName: "bot.name" })).toBe(true);
    expect(detectGroupMeMention({ text: "@botXname", botName: "bot.name" })).toBe(false);
  });
});
