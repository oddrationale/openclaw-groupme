import { describe, expect, it } from "vitest";
import { GroupMeRateLimiter } from "../src/rate-limit.js";

describe("GroupMeRateLimiter", () => {
  it("enforces per-ip threshold", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: 60_000,
      maxRequestsPerIp: 1,
      maxRequestsPerSender: 10,
      maxConcurrent: 10,
    });

    const first = limiter.evaluate({ ip: "1.2.3.4", senderId: "s1" }, 1_000);
    const second = limiter.evaluate({ ip: "1.2.3.4", senderId: "s2" }, 1_001);

    expect(first.kind).toBe("accepted");
    expect(second).toEqual({ kind: "rejected", scope: "ip" });
  });

  it("enforces per-sender threshold", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: 60_000,
      maxRequestsPerIp: 10,
      maxRequestsPerSender: 1,
      maxConcurrent: 10,
    });

    const first = limiter.evaluate({ ip: "1.2.3.4", senderId: "same" }, 1_000);
    const second = limiter.evaluate({ ip: "5.6.7.8", senderId: "same" }, 1_001);

    expect(first.kind).toBe("accepted");
    expect(second).toEqual({ kind: "rejected", scope: "sender" });
  });

  it("enforces global concurrency threshold", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: 60_000,
      maxRequestsPerIp: 10,
      maxRequestsPerSender: 10,
      maxConcurrent: 1,
    });

    const first = limiter.evaluate({ ip: "1.2.3.4", senderId: "s1" }, 1_000);
    const second = limiter.evaluate({ ip: "1.2.3.5", senderId: "s2" }, 1_001);

    expect(first.kind).toBe("accepted");
    expect(second).toEqual({ kind: "rejected", scope: "concurrency" });
    if (first.kind === "accepted") {
      first.release();
    }
    const third = limiter.evaluate({ ip: "1.2.3.6", senderId: "s3" }, 1_002);
    expect(third.kind).toBe("accepted");
  });

  it("does not consume ip/sender quota when rejected by concurrency", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: 60_000,
      maxRequestsPerIp: 2,
      maxRequestsPerSender: 2,
      maxConcurrent: 1,
    });

    const first = limiter.evaluate({ ip: "1.2.3.4", senderId: "same" }, 1_000);
    const second = limiter.evaluate({ ip: "1.2.3.4", senderId: "same" }, 1_001);

    expect(first.kind).toBe("accepted");
    expect(second).toEqual({ kind: "rejected", scope: "concurrency" });

    if (first.kind === "accepted") {
      first.release();
    }

    const third = limiter.evaluate({ ip: "1.2.3.4", senderId: "same" }, 1_002);
    expect(third.kind).toBe("accepted");
  });

  it("normalizes invalid constructor values and blank keys to safe minimums", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: 0,
      maxRequestsPerIp: 0,
      maxRequestsPerSender: Number.NaN,
      maxConcurrent: -1,
    });

    const first = limiter.evaluate({ ip: "   ", senderId: "   " }, 1_000);
    const second = limiter.evaluate({ ip: "", senderId: "" }, 1_000);

    expect(first.kind).toBe("accepted");
    expect(second).toEqual({ kind: "rejected", scope: "concurrency" });
  });

  it("normalizes NaN limits to active minimum thresholds", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: Number.NaN,
      maxRequestsPerIp: 10,
      maxRequestsPerSender: Number.NaN,
      maxConcurrent: 10,
    });

    const first = limiter.evaluate({ ip: "1.2.3.4", senderId: "same" }, 1_000);
    const second = limiter.evaluate({ ip: "1.2.3.5", senderId: "same" }, 1_000);

    expect(first.kind).toBe("accepted");
    expect(second).toEqual({ kind: "rejected", scope: "sender" });
  });

  it("releases accepted requests only once", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: 60_000,
      maxRequestsPerIp: 10,
      maxRequestsPerSender: 10,
      maxConcurrent: 1,
    });

    const first = limiter.evaluate({ ip: "1.2.3.4", senderId: "s1" }, 1_000);
    expect(first.kind).toBe("accepted");
    if (first.kind !== "accepted") {
      throw new Error("expected accepted request");
    }
    expect(limiter.inflightCount()).toBe(1);
    first.release();
    first.release();
    expect(limiter.inflightCount()).toBe(0);
  });

  it("prunes expired keys before enforcing limits", () => {
    const limiter = new GroupMeRateLimiter({
      windowMs: 10,
      maxRequestsPerIp: 1,
      maxRequestsPerSender: 1,
      maxConcurrent: 10,
    });

    expect(limiter.evaluate({ ip: "1.2.3.4", senderId: "s1" }, 1_000).kind).toBe("accepted");
    expect(limiter.evaluate({ ip: "1.2.3.4", senderId: "s1" }, 1_011).kind).toBe("accepted");
  });
});
