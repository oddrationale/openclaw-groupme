import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithSsrFGuard, SsrFBlockedError } from "openclaw/plugin-sdk/ssrf-runtime";
import { resolveGroupMeAccount } from "./accounts.js";
import { tryGetGroupMeRuntime } from "./runtime.js";
import { resolveGroupMeSecurity } from "./security.js";
import type { CoreConfig } from "./types.js";

const GROUPME_API_BASE = "https://api.groupme.com/v3";
const GROUPME_IMAGE_SERVICE = "https://image.groupme.com";
export const GROUPME_MAX_TEXT_LENGTH = 1000;

type SendGroupMeResult = {
  /**
   * The Bot API acknowledges posts with `202 Accepted` and no body, so there is
   * no platform message id to report. Keep it empty rather than fabricating one.
   */
  messageId: string;
  timestamp: number;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Host delivery fences forwarded from the outbound message context. The host
 * refreshes durable timing in `onPlatformSendDispatch` and re-checks send
 * authority in `assertDirectAdapterHandoff`; both must run immediately before
 * the provider request.
 */
export type GroupMeSendFences = {
  onPlatformSendDispatch?: () => Promise<void>;
  assertDirectAdapterHandoff?: () => void;
  signal?: AbortSignal;
};

/** Host-authorized reader for local media paths (agent-generated files). */
export type GroupMeMediaReadFile = (filePath: string) => Promise<Buffer>;

export async function sendGroupMeMessage(
  params: {
    botId: string;
    text: string;
    pictureUrl?: string;
    fetchFn?: FetchLike;
    apiBaseUrl?: string;
  } & GroupMeSendFences,
): Promise<SendGroupMeResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const apiBaseUrl = params.apiBaseUrl ?? GROUPME_API_BASE;
  const payload: { bot_id: string; text: string; picture_url?: string } = {
    bot_id: params.botId,
    text: params.text,
  };
  if (params.pictureUrl) {
    payload.picture_url = params.pictureUrl;
  }
  params.signal?.throwIfAborted();
  await params.onPlatformSendDispatch?.();
  params.assertDirectAdapterHandoff?.();
  const response = await fetchFn(`${apiBaseUrl}/bots/post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`GroupMe API error: ${response.status} ${response.statusText}`);
  }

  return {
    messageId: "",
    timestamp: Date.now(),
  };
}

function extractPictureUrl(value: unknown): string | null {
  const url = (value as { payload?: { picture_url?: unknown } })?.payload?.picture_url;
  if (typeof url !== "string") return null;
  return url.trim() || null;
}

export async function uploadGroupMeImage(params: {
  accessToken: string;
  imageData: Buffer;
  contentType?: string;
  fetchFn?: FetchLike;
  imageBaseUrl?: string;
}): Promise<string> {
  const fetchFn = params.fetchFn ?? fetch;
  const imageBaseUrl = params.imageBaseUrl ?? GROUPME_IMAGE_SERVICE;
  const response = await fetchFn(`${imageBaseUrl}/pictures`, {
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
  const runtime = tryGetGroupMeRuntime();
  if (runtime) {
    try {
      const fetched = await runtime.channel.media.readRemoteMediaBuffer({
        url: params.mediaUrl,
        fetchImpl: params.fetchFn,
        maxBytes: params.maxDownloadBytes,
        maxRedirects: 3,
        timeoutMs: params.requestTimeoutMs,
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
      if (isSsrfRelatedError(error)) {
        throw new Error(`GroupMe media download blocked by SSRF policy`);
      }
      throw error;
    }
  }

  const timedFetch = wrapFetchWithTimeout(params.fetchFn, params.requestTimeoutMs);
  try {
    const guarded = await fetchWithSsrFGuard({
      url: params.mediaUrl,
      fetchImpl: timedFetch,
      maxRedirects: 3,
      policy: {
        allowPrivateNetwork: params.allowPrivateNetworks,
      },
      auditContext: "groupme-outbound-media",
    });

    try {
      const response = guarded.response;
      if (!response.ok) {
        throw new Error(`GroupMe media download failed: ${response.status} ${response.statusText}`);
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > params.maxDownloadBytes) {
        throw new Error(
          `GroupMe media download exceeds maxDownloadBytes (${contentLength} > ${params.maxDownloadBytes})`,
        );
      }

      const contentType = enforceMimePolicy({
        contentType: response.headers.get("content-type") ?? "",
        allowedMimePrefixes: params.allowedMimePrefixes,
      });

      const data = await readResponseBodyWithLimit(response, params.maxDownloadBytes);
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

function wrapFetchWithTimeout(fetchFn: FetchLike | undefined, timeoutMs: number): FetchLike {
  const base = fetchFn ?? fetch;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort("GroupMe media fetch timed out");
    }, timeoutMs);

    // Upstream init.signal bridging: our call sites never pass one, so the abort
    // wiring below is kept for callers that do but is not exercised by tests.
    /* v8 ignore start */
    const upstreamSignal = init?.signal;
    const onAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        onAbort();
      } else {
        upstreamSignal.addEventListener("abort", onAbort, { once: true });
      }
    }
    /* v8 ignore stop */

    try {
      return await base(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      /* v8 ignore start */
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", onAbort);
      }
      /* v8 ignore stop */
    }
  };
}

function enforceMimePolicy(params: {
  contentType: string | undefined;
  allowedMimePrefixes: string[];
}): string {
  const contentType = (params.contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (
    !contentType ||
    !params.allowedMimePrefixes.some((prefix) => contentType.startsWith(prefix.toLowerCase()))
  ) {
    throw new Error(
      `GroupMe media download blocked by MIME policy (${contentType || "missing content-type"})`,
    );
  }
  return contentType;
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
  let exceededLimit = false;
  try {
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
        exceededLimit = true;
        throw new Error(
          `GroupMe media download exceeds maxDownloadBytes (${totalBytes} > ${maxDownloadBytes})`,
        );
      }
      chunks.push(chunk);
    }
  } finally {
    if (exceededLimit) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation errors; preserve original failure reason.
      }
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function sendGroupMeText(
  params: {
    cfg: CoreConfig;
    to: string;
    text: string;
    accountId?: string | null;
    fetchFn?: FetchLike;
    apiBaseUrl?: string;
  } & GroupMeSendFences,
): Promise<SendGroupMeResult> {
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
    apiBaseUrl: params.apiBaseUrl,
    onPlatformSendDispatch: params.onPlatformSendDispatch,
    assertDirectAdapterHandoff: params.assertDirectAdapterHandoff,
    signal: params.signal,
  });
}

function isRemoteMediaUrl(mediaUrl: string): boolean {
  return /^https?:\/\//i.test(mediaUrl.trim());
}

function localMediaPath(mediaUrl: string): string {
  const trimmed = mediaUrl.trim();
  return /^file:\/\//i.test(trimmed) ? fileURLToPath(trimmed) : trimmed;
}

async function readLocalMedia(params: {
  mediaUrl: string;
  mediaReadFile?: GroupMeMediaReadFile;
  maxDownloadBytes: number;
  allowedMimePrefixes: string[];
}): Promise<{ data: Buffer; contentType: string }> {
  if (!params.mediaReadFile) {
    // Only the host may authorize local file reads (sandbox roots, workspace
    // policy). Without its reader, refuse rather than touching the filesystem.
    throw new Error("GroupMe media send requires an http(s) mediaUrl for this delivery");
  }
  const filePath = localMediaPath(params.mediaUrl);
  const data = await params.mediaReadFile(filePath);
  if (data.length > params.maxDownloadBytes) {
    throw new Error(
      `GroupMe media exceeds maxDownloadBytes (${data.length} > ${params.maxDownloadBytes})`,
    );
  }
  const contentType = enforceMimePolicy({
    contentType: mimeTypeFromPath(filePath),
    allowedMimePrefixes: params.allowedMimePrefixes,
  });
  return { data, contentType };
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function mimeTypeFromPath(filePath: string): string | undefined {
  return IMAGE_MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
}

export async function sendGroupMeMedia(
  params: {
    cfg: CoreConfig;
    to: string;
    text: string;
    mediaUrl: string;
    mediaReadFile?: GroupMeMediaReadFile;
    accountId?: string | null;
    fetchFn?: FetchLike;
    apiBaseUrl?: string;
    imageBaseUrl?: string;
  } & GroupMeSendFences,
): Promise<SendGroupMeResult> {
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

  params.signal?.throwIfAborted();
  const security = resolveGroupMeSecurity(account.config);
  const { data, contentType } = isRemoteMediaUrl(params.mediaUrl)
    ? await downloadRemoteMedia({
        mediaUrl: params.mediaUrl,
        allowPrivateNetworks: security.media.allowPrivateNetworks,
        maxDownloadBytes: security.media.maxDownloadBytes,
        requestTimeoutMs: security.media.requestTimeoutMs,
        allowedMimePrefixes: security.media.allowedMimePrefixes,
        fetchFn: params.fetchFn,
      })
    : await readLocalMedia({
        mediaUrl: params.mediaUrl,
        mediaReadFile: params.mediaReadFile,
        maxDownloadBytes: security.media.maxDownloadBytes,
        allowedMimePrefixes: security.media.allowedMimePrefixes,
      });

  params.signal?.throwIfAborted();
  const pictureUrl = await uploadGroupMeImage({
    accessToken: account.accessToken,
    imageData: data,
    contentType,
    fetchFn: params.fetchFn,
    imageBaseUrl: params.imageBaseUrl,
  });

  return sendGroupMeMessage({
    botId: account.botId,
    text: params.text,
    pictureUrl,
    fetchFn: params.fetchFn,
    apiBaseUrl: params.apiBaseUrl,
    onPlatformSendDispatch: params.onPlatformSendDispatch,
    assertDirectAdapterHandoff: params.assertDirectAdapterHandoff,
    signal: params.signal,
  });
}
