import { describe, expect, it } from "vitest";
import { GroupMeReplayCache } from "../src/replay-cache.js";

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
});
