import { randomUUID } from "node:crypto";
import type { CoreConfig } from "./types.js";
import { resolveGroupMeAccount } from "./accounts.js";

export const GROUPME_API_BASE = "https://api.groupme.com/v3";
export const GROUPME_IMAGE_SERVICE = "https://image.groupme.com";
export const GROUPME_MAX_TEXT_LENGTH = 1000;

export type SendGroupMeResult = {
  messageId: string;
  timestamp: number;
};

type FetchLike = typeof fetch;

type GroupMeBotPostPayload = {
  bot_id: string;
  text: string;
  picture_url?: string;
};

function buildGroupMeBotPostPayload(params: {
  botId: string;
  text: string;
  pictureUrl?: string;
}): GroupMeBotPostPayload {
  const payload: GroupMeBotPostPayload = {
    bot_id: params.botId,
    text: params.text,
  };
  if (params.pictureUrl) {
    payload.picture_url = params.pictureUrl;
  }
  return payload;
}

export async function sendGroupMeMessage(params: {
  botId: string;
  text: string;
  pictureUrl?: string;
  fetchFn?: FetchLike;
}): Promise<SendGroupMeResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(`${GROUPME_API_BASE}/bots/post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildGroupMeBotPostPayload({
        botId: params.botId,
        text: params.text,
        pictureUrl: params.pictureUrl,
      }),
    ),
  });

  if (!response.ok) {
    throw new Error(
      `GroupMe API error: ${response.status} ${response.statusText}`,
    );
  }

  return {
    messageId: randomUUID(),
    timestamp: Date.now(),
  };
}

function extractPictureUrl(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = (value as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const pictureUrl = (payload as { picture_url?: unknown }).picture_url;
  if (typeof pictureUrl !== "string") {
    return null;
  }

  const trimmed = pictureUrl.trim();
  return trimmed || null;
}

export async function uploadGroupMeImage(params: {
  accessToken: string;
  imageData: Buffer;
  contentType?: string;
  fetchFn?: FetchLike;
}): Promise<string> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(`${GROUPME_IMAGE_SERVICE}/pictures`, {
    method: "POST",
    headers: {
      "X-Access-Token": params.accessToken,
      "Content-Type": params.contentType ?? "image/jpeg",
    },
    body: new Uint8Array(params.imageData),
  });

  if (!response.ok) {
    throw new Error(`GroupMe image upload failed: ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  const pictureUrl = extractPictureUrl(json);
  if (!pictureUrl) {
    throw new Error("GroupMe image upload: no picture_url in response");
  }

  return pictureUrl;
}

async function downloadRemoteMedia(params: {
  mediaUrl: string;
  fetchFn?: FetchLike;
}): Promise<{ data: Buffer; contentType: string }> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(params.mediaUrl);
  if (!response.ok) {
    throw new Error(
      `GroupMe media download failed: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const data = Buffer.from(await response.arrayBuffer());

  return { data, contentType };
}

export async function sendGroupMeText(params: {
  cfg: CoreConfig;
  to: string;
  text: string;
  accountId?: string | null;
  fetchFn?: FetchLike;
}): Promise<SendGroupMeResult> {
  const account = resolveGroupMeAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  if (!account.botId) {
    throw new Error(`GroupMe account "${account.accountId}" is missing botId`);
  }

  return sendGroupMeMessage({
    botId: account.botId,
    text: params.text,
    fetchFn: params.fetchFn,
  });
}

export async function sendGroupMeMedia(params: {
  cfg: CoreConfig;
  to: string;
  text: string;
  mediaUrl: string;
  accountId?: string | null;
  fetchFn?: FetchLike;
}): Promise<SendGroupMeResult> {
  const account = resolveGroupMeAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });

  if (!account.botId) {
    throw new Error(`GroupMe account "${account.accountId}" is missing botId`);
  }
  if (!account.accessToken) {
    throw new Error(
      `GroupMe account "${account.accountId}" is missing accessToken required for image uploads`,
    );
  }

  const { data, contentType } = await downloadRemoteMedia({
    mediaUrl: params.mediaUrl,
    fetchFn: params.fetchFn,
  });

  const pictureUrl = await uploadGroupMeImage({
    accessToken: account.accessToken,
    imageData: data,
    contentType,
    fetchFn: params.fetchFn,
  });

  return sendGroupMeMessage({
    botId: account.botId,
    text: params.text,
    pictureUrl,
    fetchFn: params.fetchFn,
  });
}
