import { createHash } from "node:crypto";
import type { GroupMeCallbackData, ReplayCheck } from "./types.js";

type ReplayEntry = {
  expiresAt: number;
};

export class GroupMeReplayCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, ReplayEntry>();

  constructor(params: { ttlSeconds: number; maxEntries: number }) {
    this.ttlMs = Math.max(1, Math.floor(params.ttlSeconds * 1000));
    this.maxEntries = Math.max(1, Math.floor(params.maxEntries));
  }

  checkAndRemember(key: string, now = Date.now()): ReplayCheck {
    this.pruneExpired(now);

    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      return { kind: "duplicate", key };
    }

    this.entries.delete(key);
    this.entries.set(key, { expiresAt: now + this.ttlMs });
    this.evictOverflow();
    return { kind: "accepted", key };
  }

  size(): number {
    return this.entries.size;
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) {
        continue;
      }
      this.entries.delete(key);
    }
  }

  private evictOverflow() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}

export function buildReplayKey(message: GroupMeCallbackData): string {
  const id = message.id.trim();
  if (id) {
    return `id:${id}`;
  }
  const sourceGuid = message.sourceGuid.trim();
  if (sourceGuid) {
    return `source_guid:${sourceGuid}`;
  }
  const fallback = createHash("sha256")
    .update(
      `${message.groupId}\u0000${message.senderId}\u0000${message.createdAt}\u0000${message.text}`,
    )
    .digest("hex");
  return `fallback:${fallback}`;
}
