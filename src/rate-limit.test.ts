import { describe, expect, it } from "vitest";
import { GroupMeRateLimiter } from "./rate-limit.js";

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
    const second = limiter.evaluate(
      { ip: "5.6.7.8", senderId: "same" },
      1_001,
    );

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
});
