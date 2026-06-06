import { describe, expect, it } from "vitest";
import { buildReplayKey, GroupMeReplayCache } from "../../src/replay-cache.js";
import type { GroupMeCallbackData } from "../../src/types.js";

describe("GroupMeReplayCache", () => {
  it("accepts first key and rejects duplicate within ttl", () => {
    const cache = new GroupMeReplayCache({ ttlSeconds: 60, maxEntries: 100 });
    const first = cache.checkAndRemember("msg-1", 1_000);
    const second = cache.checkAndRemember("msg-1", 2_000);

    expect(first).toEqual({ kind: "accepted", key: "msg-1" });
    expect(second).toEqual({ kind: "duplicate", key: "msg-1" });
  });

  it("accepts again after ttl expiry", () => {
    const cache = new GroupMeReplayCache({ ttlSeconds: 1, maxEntries: 100 });
    const first = cache.checkAndRemember("msg-1", 1_000);
    const second = cache.checkAndRemember("msg-1", 2_001);

    expect(first).toEqual({ kind: "accepted", key: "msg-1" });
    expect(second).toEqual({ kind: "accepted", key: "msg-1" });
  });

  it("evicts oldest entries when maxEntries is exceeded", () => {
    const cache = new GroupMeReplayCache({ ttlSeconds: 60, maxEntries: 2 });
    cache.checkAndRemember("k1", 1_000);
    cache.checkAndRemember("k2", 1_001);
    cache.checkAndRemember("k3", 1_002);

    expect(cache.size()).toBe(2);
    expect(cache.checkAndRemember("k1", 1_003)).toEqual({
      kind: "accepted",
      key: "k1",
    });
  });

  it("normalizes invalid constructor values to minimums", () => {
    const cache = new GroupMeReplayCache({ ttlSeconds: 0, maxEntries: 0 });
    cache.checkAndRemember("k1", 1_000);
    cache.checkAndRemember("k2", 1_000);

    expect(cache.size()).toBe(1);
  });

  it("builds stable replay keys from id, source_guid, or message content", () => {
    const message: GroupMeCallbackData = {
      id: " msg-1 ",
      text: "hello",
      name: "Alice",
      senderType: "user",
      senderId: "u1",
      userId: "u1",
      groupId: "g1",
      sourceGuid: " src-1 ",
      createdAt: 1,
      system: false,
      avatarUrl: null,
      attachments: [],
    };

    expect(buildReplayKey(message)).toBe("id:msg-1");
    expect(buildReplayKey({ ...message, id: " " })).toBe("source_guid:src-1");

    const fallback = buildReplayKey({ ...message, id: "", sourceGuid: "" });
    expect(fallback).toMatch(/^fallback:[0-9a-f]{64}$/);
    expect(buildReplayKey({ ...message, id: "", sourceGuid: "" })).toBe(fallback);
  });
});
