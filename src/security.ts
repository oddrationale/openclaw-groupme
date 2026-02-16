import { timingSafeEqual } from "node:crypto";
import type {
  CallbackAuthResult,
  GroupMeAccountConfig,
  GroupMeSecurityConfig,
} from "./types.js";

export type ResolvedGroupMeSecurity = {
  callbackAuth: {
    enabled: boolean;
    token: string;
    tokenLocation: "query" | "path" | "either";
    queryKey: string;
    previousTokens: string[];
    rejectStatus: 200 | 401 | 403 | 404;
  };
  groupBinding: {
    enabled: boolean;
    expectedGroupId: string;
  };
  replay: {
    enabled: boolean;
    ttlSeconds: number;
    maxEntries: number;
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    maxRequestsPerIp: number;
    maxRequestsPerSender: number;
    maxConcurrent: number;
  };
  media: {
    allowPrivateNetworks: boolean;
    maxDownloadBytes: number;
    requestTimeoutMs: number;
    allowedMimePrefixes: string[];
  };
  logging: {
    redactSecrets: boolean;
    logRejectedRequests: boolean;
  };
  commandBypass: {
    requireAllowFrom: boolean;
    requireMentionForCommands: boolean;
  };
};

function readTrimmed(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeTokenList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const entry of value) {
    const token = readTrimmed(entry);
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

export function resolveGroupMeSecurity(
  accountConfig: GroupMeAccountConfig,
): ResolvedGroupMeSecurity {
  const security = (accountConfig.security ?? {}) as GroupMeSecurityConfig;
  const callbackAuth = security.callbackAuth ?? {};
  const activeToken = readTrimmed(callbackAuth.token);
  const previousTokens = normalizeTokenList(callbackAuth.previousTokens).filter(
    (token) => token !== activeToken,
  );

  const allowedMimePrefixes = Array.isArray(security.media?.allowedMimePrefixes)
    ? security.media.allowedMimePrefixes
        .map((prefix) => readTrimmed(prefix))
        .filter(Boolean)
    : ["image/"];

  return {
    callbackAuth: {
      enabled: callbackAuth.enabled !== false,
      token: activeToken,
      tokenLocation: callbackAuth.tokenLocation ?? "query",
      queryKey: readTrimmed(callbackAuth.queryKey) || "k",
      previousTokens,
      rejectStatus: callbackAuth.rejectStatus ?? 404,
    },
    groupBinding: {
      enabled: security.groupBinding?.enabled !== false,
      expectedGroupId: readTrimmed(security.groupBinding?.expectedGroupId),
    },
    replay: {
      enabled: security.replay?.enabled !== false,
      ttlSeconds:
        Number.isFinite(security.replay?.ttlSeconds) &&
        (security.replay?.ttlSeconds as number) > 0
          ? Math.floor(security.replay?.ttlSeconds as number)
          : 600,
      maxEntries:
        Number.isFinite(security.replay?.maxEntries) &&
        (security.replay?.maxEntries as number) > 0
          ? Math.floor(security.replay?.maxEntries as number)
          : 10_000,
    },
    rateLimit: {
      enabled: security.rateLimit?.enabled !== false,
      windowMs:
        Number.isFinite(security.rateLimit?.windowMs) &&
        (security.rateLimit?.windowMs as number) > 0
          ? Math.floor(security.rateLimit?.windowMs as number)
          : 60_000,
      maxRequestsPerIp:
        Number.isFinite(security.rateLimit?.maxRequestsPerIp) &&
        (security.rateLimit?.maxRequestsPerIp as number) > 0
          ? Math.floor(security.rateLimit?.maxRequestsPerIp as number)
          : 120,
      maxRequestsPerSender:
        Number.isFinite(security.rateLimit?.maxRequestsPerSender) &&
        (security.rateLimit?.maxRequestsPerSender as number) > 0
          ? Math.floor(security.rateLimit?.maxRequestsPerSender as number)
          : 60,
      maxConcurrent:
        Number.isFinite(security.rateLimit?.maxConcurrent) &&
        (security.rateLimit?.maxConcurrent as number) > 0
          ? Math.floor(security.rateLimit?.maxConcurrent as number)
          : 8,
    },
    media: {
      allowPrivateNetworks: security.media?.allowPrivateNetworks === true,
      maxDownloadBytes:
        Number.isFinite(security.media?.maxDownloadBytes) &&
        (security.media?.maxDownloadBytes as number) > 0
          ? Math.floor(security.media?.maxDownloadBytes as number)
          : 15 * 1024 * 1024,
      requestTimeoutMs:
        Number.isFinite(security.media?.requestTimeoutMs) &&
        (security.media?.requestTimeoutMs as number) > 0
          ? Math.floor(security.media?.requestTimeoutMs as number)
          : 10_000,
      allowedMimePrefixes:
        allowedMimePrefixes.length > 0 ? allowedMimePrefixes : ["image/"],
    },
    logging: {
      redactSecrets: security.logging?.redactSecrets !== false,
      logRejectedRequests: security.logging?.logRejectedRequests !== false,
    },
    commandBypass: {
      requireAllowFrom: security.commandBypass?.requireAllowFrom !== false,
      requireMentionForCommands:
        security.commandBypass?.requireMentionForCommands === true,
    },
  };
}

function safeEqualToken(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function extractPathToken(pathname: string): string {
  const trimmedPath = pathname.replace(/\/+$/, "");
  if (!trimmedPath) {
    return "";
  }
  const segments = trimmedPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  return decodeURIComponent(segments[segments.length - 1] ?? "");
}

function readCallbackToken(params: {
  url: URL;
  tokenLocation: "query" | "path" | "either";
  queryKey: string;
}): string {
  const queryToken = params.url.searchParams.get(params.queryKey)?.trim() ?? "";
  const pathToken = extractPathToken(params.url.pathname).trim();

  if (params.tokenLocation === "query") {
    return queryToken;
  }
  if (params.tokenLocation === "path") {
    return pathToken;
  }
  return queryToken || pathToken;
}

export function verifyCallbackAuth(params: {
  url: URL;
  security: ResolvedGroupMeSecurity;
}): CallbackAuthResult {
  const callbackAuth = params.security.callbackAuth;
  if (!callbackAuth.enabled) {
    return { ok: false, reason: "disabled" };
  }
  if (!callbackAuth.token) {
    return { ok: false, reason: "not-configured" };
  }

  const token = readCallbackToken({
    url: params.url,
    tokenLocation: callbackAuth.tokenLocation,
    queryKey: callbackAuth.queryKey,
  });
  if (!token) {
    return { ok: false, reason: "missing" };
  }
  if (safeEqualToken(token, callbackAuth.token)) {
    return { ok: true, tokenId: "active" };
  }
  if (callbackAuth.previousTokens.some((prev) => safeEqualToken(token, prev))) {
    return { ok: true, tokenId: "previous" };
  }
  return { ok: false, reason: "mismatch" };
}

export function checkGroupBinding(params: {
  expectedGroupId: string;
  inboundGroupId: string;
  enabled: boolean;
}): { ok: true } | { ok: false; reason: "missing" | "mismatch" } {
  if (!params.enabled) {
    return { ok: true };
  }
  if (!params.expectedGroupId) {
    return { ok: false, reason: "missing" };
  }
  if (params.expectedGroupId !== params.inboundGroupId) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

export function redactCallbackUrl(
  raw: string,
  security: ResolvedGroupMeSecurity,
): string {
  const callbackAuth = security.callbackAuth;
  let redacted = raw;

  const tokens = [
    callbackAuth.token,
    ...callbackAuth.previousTokens,
  ].filter(Boolean);
  for (const token of tokens) {
    redacted = redacted.replaceAll(token, "[redacted]");
  }

  try {
    const parsed = new URL(redacted, "http://localhost");
    if (
      callbackAuth.tokenLocation === "query" ||
      callbackAuth.tokenLocation === "either"
    ) {
      if (parsed.searchParams.has(callbackAuth.queryKey)) {
        parsed.searchParams.set(callbackAuth.queryKey, "[redacted]");
      }
    }
    const serialized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return serialized || redacted;
  } catch {
    return redacted;
  }
}
