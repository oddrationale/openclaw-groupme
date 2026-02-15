import type {
  GroupMeAttachment,
  GroupMeCallbackData,
  GroupMeEmojiAttachment,
  GroupMeImageAttachment,
  GroupMeLocationAttachment,
  GroupMeMentionsAttachment,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseNumberMatrix(value: unknown): number[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) {
      continue;
    }
    const parsedRow: number[] = [];
    for (const cell of row) {
      const num = readNumber(cell);
      if (typeof num !== "number") {
        continue;
      }
      parsedRow.push(num);
    }
    if (parsedRow.length > 0) {
      rows.push(parsedRow);
    }
  }
  return rows;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
}

function parseAttachment(entry: unknown): GroupMeAttachment | null {
  if (!isRecord(entry)) {
    return null;
  }

  const type = readString(entry.type);
  if (!type) {
    return null;
  }

  if (type === "image") {
    const url = readString(entry.url);
    if (!url) {
      return null;
    }
    const imageAttachment: GroupMeImageAttachment = {
      type,
      url,
    };
    return imageAttachment;
  }

  if (type === "location") {
    const lat = readString(entry.lat);
    const lng = readString(entry.lng);
    const name = readString(entry.name);
    if (!lat || !lng || !name) {
      return null;
    }
    const locationAttachment: GroupMeLocationAttachment = {
      type,
      lat,
      lng,
      name,
    };
    return locationAttachment;
  }

  if (type === "mentions") {
    const mentionsAttachment: GroupMeMentionsAttachment = {
      type,
      user_ids: parseStringArray(entry.user_ids),
      loci: parseNumberMatrix(entry.loci),
    };
    return mentionsAttachment;
  }

  if (type === "emoji") {
    const placeholder = readString(entry.placeholder);
    if (!placeholder) {
      return null;
    }
    const emojiAttachment: GroupMeEmojiAttachment = {
      type,
      placeholder,
      charmap: parseNumberMatrix(entry.charmap),
    };
    return emojiAttachment;
  }

  return {
    ...entry,
    type,
  };
}

function parseAttachments(value: unknown): GroupMeAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: GroupMeAttachment[] = [];
  for (const entry of value) {
    const parsed = parseAttachment(entry);
    if (parsed) {
      attachments.push(parsed);
    }
  }
  return attachments;
}

export function parseGroupMeCallback(data: unknown): GroupMeCallbackData | null {
  if (!isRecord(data)) {
    return null;
  }

  const id = readString(data.id);
  const name = readString(data.name);
  const senderType = readString(data.sender_type);
  const senderId = readString(data.sender_id);
  const userId = readString(data.user_id);
  const groupId = readString(data.group_id);
  const sourceGuid = readString(data.source_guid);
  const createdAt = readNumber(data.created_at);

  if (!id || !name || !senderType || !senderId || !userId || !groupId || !sourceGuid) {
    return null;
  }
  if (typeof createdAt !== "number") {
    return null;
  }

  const avatarUrl = readString(data.avatar_url) ?? null;
  const text = typeof data.text === "string" ? data.text : "";

  return {
    id,
    text,
    name,
    senderType,
    senderId,
    userId,
    groupId,
    sourceGuid,
    createdAt,
    system: readBoolean(data.system) ?? false,
    avatarUrl,
    attachments: parseAttachments(data.attachments),
  };
}

export function hasImageAttachment(attachments: GroupMeAttachment[]): boolean {
  return attachments.some((attachment) => attachment.type === "image");
}

export function shouldProcessCallback(msg: GroupMeCallbackData): string | null {
  if (msg.senderType !== "user") {
    return "non-user message";
  }
  if (msg.system) {
    return "system message";
  }
  if (!msg.text.trim() && !hasImageAttachment(msg.attachments)) {
    return "empty message";
  }

  return null;
}

export function extractImageUrls(attachments: GroupMeAttachment[]): string[] {
  return attachments
    .filter((attachment): attachment is GroupMeImageAttachment => attachment.type === "image")
    .map((attachment) => attachment.url);
}

function normalizeMentionText(text: string): string {
  return text.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "").toLowerCase();
}

function buildRegexes(patterns?: string[]): RegExp[] {
  if (!patterns || patterns.length === 0) {
    return [];
  }

  return patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    })
    .filter((entry): entry is RegExp => Boolean(entry));
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectGroupMeMention(params: {
  text: string;
  botName?: string;
  channelMentionPatterns?: string[];
  mentionRegexes?: RegExp[];
}): boolean {
  const text = params.text?.trim() ?? "";
  if (!text) {
    return false;
  }

  const normalizedText = normalizeMentionText(text);
  const channelRegexes = buildRegexes(params.channelMentionPatterns);
  if (channelRegexes.some((regex) => regex.test(text))) {
    return true;
  }

  const mentionRegexes = params.mentionRegexes ?? [];
  if (mentionRegexes.some((regex) => regex.test(normalizedText))) {
    return true;
  }

  const botName = params.botName?.trim();
  if (!botName) {
    return false;
  }

  const escaped = escapeRegexLiteral(botName);
  const botRegex = new RegExp(`\\b@?${escaped}\\b`, "i");
  return botRegex.test(text);
}
