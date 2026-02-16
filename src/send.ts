import { randomUUID } from "node:crypto";
import { SsrFBlockedError, fetchWithSsrFGuard } from "openclaw/plugin-sdk";
import type { CoreConfig } from "./types.js";
import { resolveGroupMeAccount } from "./accounts.js";
import { getGroupMeRuntime } from "./runtime.js";
import { resolveGroupMeSecurity } from "./security.js";

export const GROUPME_API_BASE = "https://api.groupme.com/v3";
export const GROUPME_IMAGE_SERVICE = "https://image.groupme.com";
export const GROUPME_MAX_TEXT_LENGTH = 1000;

export type SendGroupMeResult = {
  messageId: string;
  timestamp: number;
};

type FetchLike = typeof fetch;
type RuntimeFetchRemoteMedia = (params: {
  url: string;
  fetchImpl?: FetchLike;
  maxBytes?: number;
  maxRedirects?: number;
  ssrfPolicy?: {
    allowPrivateNetwork?: boolean;
  };
}) => Promise<{
  buffer: Buffer;
  contentType?: string;
}>;

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
  allowPrivateNetworks: boolean;
  maxDownloadBytes: number;
  requestTimeoutMs: number;
  allowedMimePrefixes: string[];
  fetchFn?: FetchLike;
}): Promise<{ data: Buffer; contentType: string }> {
  const timedFetch = wrapFetchWithTimeout(
    params.fetchFn,
    params.requestTimeoutMs,
  );

  try {
    const runtimeFetcher = getGroupMeRuntime().channel.media
      .fetchRemoteMedia as RuntimeFetchRemoteMedia;
    const fetched = await runtimeFetcher({
      url: params.mediaUrl,
      fetchImpl: timedFetch,
      maxBytes: params.maxDownloadBytes,
      maxRedirects: 3,
      ssrfPolicy: {
        allowPrivateNetwork: params.allowPrivateNetworks,
      },
    });

    const contentType = enforceMimePolicy({
      contentType: fetched.contentType,
      allowedMimePrefixes: params.allowedMimePrefixes,
    });
    return { data: fetched.buffer, contentType };
  } catch (error) {
    if (!isRuntimeNotInitializedError(error)) {
      if (isSsrfRelatedError(error)) {
        throw new Error(`GroupMe media download blocked by SSRF policy`);
      }
      throw error;
    }
  }

  try {
    const guarded = await fetchWithSsrFGuard({
      url: params.mediaUrl,
      fetchImpl: timedFetch,
      timeoutMs: params.requestTimeoutMs,
      maxRedirects: 3,
      policy: {
        allowPrivateNetwork: params.allowPrivateNetworks,
      },
      auditContext: "groupme-outbound-media",
    });

    try {
      const response = guarded.response;
      if (!response.ok) {
        throw new Error(
          `GroupMe media download failed: ${response.status} ${response.statusText}`,
        );
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > params.maxDownloadBytes
      ) {
        throw new Error(
          `GroupMe media download exceeds maxDownloadBytes (${contentLength} > ${params.maxDownloadBytes})`,
        );
      }

      const contentType = enforceMimePolicy({
        contentType: response.headers.get("content-type") ?? "",
        allowedMimePrefixes: params.allowedMimePrefixes,
      });

      const data = await readResponseBodyWithLimit(
        response,
        params.maxDownloadBytes,
      );
      return { data, contentType };
    } finally {
      await guarded.release();
    }
  } catch (error) {
    if (error instanceof SsrFBlockedError) {
      throw new Error(`GroupMe media download blocked by SSRF policy`);
    }
    throw error;
  }
}

function wrapFetchWithTimeout(
  fetchFn: FetchLike | undefined,
  timeoutMs: number,
): FetchLike {
  const base = fetchFn ?? fetch;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort("GroupMe media fetch timed out");
    }, timeoutMs);

    const upstreamSignal = init?.signal;
    const onAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        onAbort();
      } else {
        upstreamSignal.addEventListener("abort", onAbort, { once: true });
      }
    }

    try {
      return await base(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", onAbort);
      }
    }
  };
}

function enforceMimePolicy(params: {
  contentType: string | undefined;
  allowedMimePrefixes: string[];
}): string {
  const contentType = (params.contentType ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    !contentType ||
    !params.allowedMimePrefixes.some((prefix) =>
      contentType.startsWith(prefix.toLowerCase()),
    )
  ) {
    throw new Error(
      `GroupMe media download blocked by MIME policy (${contentType || "missing content-type"})`,
    );
  }
  return contentType;
}

function isRuntimeNotInitializedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /runtime not initialized/i.test(error.message);
}

function isSsrfRelatedError(error: unknown): boolean {
  if (error instanceof SsrFBlockedError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return /ssrf/i.test(error.message);
}

async function readResponseBodyWithLimit(
  response: Response,
  maxDownloadBytes: number,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.length > maxDownloadBytes) {
      throw new Error(
        `GroupMe media download exceeds maxDownloadBytes (${fallback.length} > ${maxDownloadBytes})`,
      );
    }
    return fallback;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    const chunk = next.value;
    if (!chunk || chunk.length === 0) {
      continue;
    }
    totalBytes += chunk.length;
    if (totalBytes > maxDownloadBytes) {
      throw new Error(
        `GroupMe media download exceeds maxDownloadBytes (${totalBytes} > ${maxDownloadBytes})`,
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
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

  const security = resolveGroupMeSecurity(account.config);
  const { data, contentType } = await downloadRemoteMedia({
    mediaUrl: params.mediaUrl,
    allowPrivateNetworks: security.media.allowPrivateNetworks,
    maxDownloadBytes: security.media.maxDownloadBytes,
    requestTimeoutMs: security.media.requestTimeoutMs,
    allowedMimePrefixes: security.media.allowedMimePrefixes,
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
