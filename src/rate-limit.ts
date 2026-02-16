export type RateLimitCheck =
  | { kind: "accepted"; release: () => void }
  | { kind: "rejected"; scope: "ip" | "sender" | "concurrency" };

type SlidingWindowState = Map<string, number[]>;
const DEFAULT_MAX_TRACKED_KEYS = 10_000;

function allowInWindow(params: {
  state: SlidingWindowState;
  key: string;
  limit: number;
  windowMs: number;
  now: number;
}): boolean {
  const { state, key, limit, windowMs, now } = params;
  const current = state.get(key) ?? [];
  const minTs = now - windowMs;
  const retained = current.filter((ts) => ts > minTs);
  if (retained.length >= limit) {
    state.set(key, retained);
    return false;
  }
  retained.push(now);
  state.set(key, retained);
  return true;
}

export class GroupMeRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequestsPerIp: number;
  private readonly maxRequestsPerSender: number;
  private readonly maxConcurrent: number;
  private readonly maxTrackedKeys: number;
  private readonly byIp: SlidingWindowState = new Map();
  private readonly bySender: SlidingWindowState = new Map();
  private inFlight = 0;

  constructor(params: {
    windowMs: number;
    maxRequestsPerIp: number;
    maxRequestsPerSender: number;
    maxConcurrent: number;
  }) {
    this.windowMs = Math.max(1, Math.floor(params.windowMs));
    this.maxRequestsPerIp = Math.max(1, Math.floor(params.maxRequestsPerIp));
    this.maxRequestsPerSender = Math.max(
      1,
      Math.floor(params.maxRequestsPerSender),
    );
    this.maxConcurrent = Math.max(1, Math.floor(params.maxConcurrent));
    this.maxTrackedKeys = DEFAULT_MAX_TRACKED_KEYS;
  }

  evaluate(params: { ip: string; senderId: string }, now = Date.now()): RateLimitCheck {
    const ipKey = params.ip.trim() || "unknown";
    const senderKey = params.senderId.trim() || "unknown";
    this.pruneState(this.byIp, now);
    this.pruneState(this.bySender, now);
    this.capStateSize(this.byIp);
    this.capStateSize(this.bySender);

    if (
      !allowInWindow({
        state: this.byIp,
        key: ipKey,
        limit: this.maxRequestsPerIp,
        windowMs: this.windowMs,
        now,
      })
    ) {
      return { kind: "rejected", scope: "ip" };
    }
    if (
      !allowInWindow({
        state: this.bySender,
        key: senderKey,
        limit: this.maxRequestsPerSender,
        windowMs: this.windowMs,
        now,
      })
    ) {
      return { kind: "rejected", scope: "sender" };
    }
    if (this.inFlight >= this.maxConcurrent) {
      return { kind: "rejected", scope: "concurrency" };
    }

    this.inFlight += 1;
    let released = false;
    return {
      kind: "accepted",
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.inFlight = Math.max(0, this.inFlight - 1);
      },
    };
  }

  inflightCount(): number {
    return this.inFlight;
  }

  private pruneState(state: SlidingWindowState, now: number) {
    const minTs = now - this.windowMs;
    for (const [key, timestamps] of state) {
      const retained = timestamps.filter((ts) => ts > minTs);
      if (retained.length === 0) {
        state.delete(key);
        continue;
      }
      state.set(key, retained);
    }
  }

  private capStateSize(state: SlidingWindowState) {
    while (state.size > this.maxTrackedKeys) {
      const oldest = state.keys().next().value as string | undefined;
      if (!oldest) {
        return;
      }
      state.delete(oldest);
    }
  }
}
