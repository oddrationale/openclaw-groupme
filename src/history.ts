import type { HistoryEntry } from "openclaw/plugin-sdk";

export const DEFAULT_GROUPME_HISTORY_LIMIT = 20;

export function resolveGroupMeHistoryLimit(configured?: number): number {
  if (!Number.isFinite(configured)) {
    return DEFAULT_GROUPME_HISTORY_LIMIT;
  }

  const normalized = Math.floor(configured as number);
  if (normalized < 0) {
    return DEFAULT_GROUPME_HISTORY_LIMIT;
  }

  return normalized;
}

export function resolveGroupMeBodyForAgent(params: {
  rawBody: string;
  imageUrls: string[];
}): string {
  const { rawBody, imageUrls } = params;
  const trimmed = rawBody.trim();
  if (trimmed) {
    return trimmed;
  }
  if (imageUrls.length > 0) {
    return imageUrls.map((url) => `Image: ${url}`).join("\n");
  }
  return rawBody;
}

export function buildGroupMeHistoryEntry(params: {
  senderName: string;
  body: string;
  timestamp: number;
  messageId: string;
}): HistoryEntry | null {
  const body = params.body.trim();
  if (!body) {
    return null;
  }

  return {
    sender: params.senderName,
    body,
    timestamp: params.timestamp,
    messageId: params.messageId,
  };
}

export function formatGroupMeHistoryEntry(entry: HistoryEntry): string {
  return `${entry.sender}: ${entry.body}`;
}
