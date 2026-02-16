import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { BlockList, isIP } from "node:net";
import type {
  CallbackAuthResult,
  GroupMeAccountConfig,
  GroupMeSecurityConfig,
} from "./types.js";

type ProxyRule = {
  kind: "cidr" | "ip";
  value: string;
};

const IPV4_MAX_CIDR_PREFIX = 32;
const IPV6_MAX_CIDR_PREFIX = 128;

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
  proxy: {
    enabled: boolean;
    trustedProxyCidrs: string[];
    allowedPublicHosts: string[];
    requireHttpsProto: boolean;
    rejectStatus: 400 | 403 | 404;
    isTrustedProxy: (ip: string) => boolean;
  };
};

export type GroupMeWebhookRequestContext = {
  remoteIp: string;
  clientIp: string;
  host: string;
  proto: "http" | "https";
  fromTrustedProxy: boolean;
  usingForwardedHeaders: boolean;
};

export type GroupMeProxyValidation =
  | { ok: true; context: GroupMeWebhookRequestContext }
  | {
      ok: false;
      reason: "missing_host" | "host_not_allowed" | "proto_not_https";
      status: number;
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

function normalizeIpCandidate(raw: string): string {
  let value = raw.trim();
  if (!value) {
    return "";
  }
  if (value.includes(",")) {
    value = value.split(",")[0]?.trim() ?? "";
  }
  if (value.startsWith("[")) {
    const endIndex = value.indexOf("]");
    if (endIndex > 0) {
      value = value.slice(1, endIndex);
    }
  }
  const zoneIndex = value.indexOf("%");
  if (zoneIndex > 0) {
    value = value.slice(0, zoneIndex);
  }
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (isIP(mapped) === 4) {
      value = mapped;
    }
  }
  if (isIP(value) === 0) {
    const maybeWithPort = value.split(":");
    if (
      maybeWithPort.length === 2 &&
      /^\d+$/.test(maybeWithPort[1] ?? "") &&
      isIP(maybeWithPort[0] ?? "") === 4
    ) {
      value = maybeWithPort[0] ?? "";
    }
  }
  return isIP(value) === 0 ? "" : value;
}

function getHeaderValue(headers: IncomingHttpHeaders, key: string): string {
  const raw = headers[key];
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    return raw[0]?.trim() ?? "";
  }
  return "";
}

function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (!host) {
    return "";
  }
  if (host.includes(",")) {
    host = host.split(",")[0]?.trim() ?? "";
  }
  if (!host) {
    return "";
  }
  if (host.startsWith("[")) {
    const endBracket = host.indexOf("]");
    if (endBracket <= 0) {
      return "";
    }
    return host.slice(1, endBracket);
  }
  if (host.includes("@")) {
    return "";
  }
  const maybeWithoutPort = host.split(":");
  if (
    maybeWithoutPort.length === 2 &&
    /^\d+$/.test(maybeWithoutPort[1] ?? "")
  ) {
    host = maybeWithoutPort[0] ?? "";
  }
  return host.trim();
}

function parseProxyRules(entries: string[]): ProxyRule[] {
  const rules: ProxyRule[] = [];
  for (const entry of entries) {
    const raw = entry.trim();
    if (!raw) {
      continue;
    }
    if (raw.includes("/")) {
      const [network, prefixRaw] = raw.split("/");
      const normalizedNetwork = normalizeIpCandidate(network ?? "");
      const ipVersion = isIP(normalizedNetwork);
      if (!ipVersion) {
        continue;
      }
      const prefix = Number(prefixRaw);
      const maxPrefix =
        ipVersion === 4 ? IPV4_MAX_CIDR_PREFIX : IPV6_MAX_CIDR_PREFIX;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        continue;
      }
      rules.push({ kind: "cidr", value: `${normalizedNetwork}/${prefix}` });
      continue;
    }
    const normalizedIp = normalizeIpCandidate(raw);
    if (normalizedIp) {
      rules.push({ kind: "ip", value: normalizedIp });
    }
  }
  return rules;
}

function createTrustedProxyMatcher(entries: string[]): (ip: string) => boolean {
  const rules = parseProxyRules(entries);
  if (rules.length === 0) {
    return () => false;
  }

  const blockList = new BlockList();
  for (const rule of rules) {
    if (rule.kind === "ip") {
      const version = isIP(rule.value);
      if (version === 4) {
        blockList.addAddress(rule.value, "ipv4");
      } else if (version === 6) {
        blockList.addAddress(rule.value, "ipv6");
      }
      continue;
    }
    const [network, prefixRaw] = rule.value.split("/");
    const prefix = Number(prefixRaw);
    const version = isIP(network);
    if (version === 4) {
      blockList.addSubnet(network, prefix, "ipv4");
    } else if (version === 6) {
      blockList.addSubnet(network, prefix, "ipv6");
    }
  }

  return (ip: string) => {
    const normalized = normalizeIpCandidate(ip);
    if (!normalized) {
      return false;
    }
    if (isIP(normalized) === 4) {
      return blockList.check(normalized, "ipv4");
    }
    return blockList.check(normalized, "ipv6");
  };
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
  const trustedProxyCidrs = Array.isArray(security.proxy?.trustedProxyCidrs)
    ? security.proxy.trustedProxyCidrs
        .map((entry) => readTrimmed(entry))
        .filter(Boolean)
    : [];
  const allowedPublicHosts = Array.isArray(security.proxy?.allowedPublicHosts)
    ? security.proxy.allowedPublicHosts
        .map((entry) => normalizeHost(readTrimmed(entry)))
        .filter(Boolean)
    : [];

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
    proxy: {
      enabled: security.proxy?.enabled === true,
      trustedProxyCidrs,
      allowedPublicHosts,
      requireHttpsProto: security.proxy?.requireHttpsProto === true,
      rejectStatus: security.proxy?.rejectStatus ?? 403,
      isTrustedProxy: createTrustedProxyMatcher(trustedProxyCidrs),
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

export function validateProxyRequest(params: {
  headers: IncomingHttpHeaders;
  remoteAddress: string;
  socketEncrypted: boolean;
  security: ResolvedGroupMeSecurity;
}): GroupMeProxyValidation {
  const remoteIp = normalizeIpCandidate(params.remoteAddress) || "unknown";
  const proxyConfig = params.security.proxy;
  const defaultProto: "http" | "https" = params.socketEncrypted
    ? "https"
    : "http";
  const hostHeader = normalizeHost(getHeaderValue(params.headers, "host"));

  if (!proxyConfig.enabled) {
    return {
      ok: true,
      context: {
        remoteIp,
        clientIp: remoteIp,
        host: hostHeader,
        proto: defaultProto,
        fromTrustedProxy: false,
        usingForwardedHeaders: false,
      },
    };
  }

  const fromTrustedProxy =
    proxyConfig.trustedProxyCidrs.length > 0 &&
    proxyConfig.isTrustedProxy(remoteIp);

  const forwardedFor = normalizeIpCandidate(
    getHeaderValue(params.headers, "x-forwarded-for"),
  );
  const forwardedHost = normalizeHost(
    getHeaderValue(params.headers, "x-forwarded-host"),
  );
  const forwardedProtoRaw = getHeaderValue(params.headers, "x-forwarded-proto")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  const forwardedProto: "http" | "https" | null =
    forwardedProtoRaw === "http" || forwardedProtoRaw === "https"
      ? forwardedProtoRaw
      : null;

  const usingForwardedHeaders =
    fromTrustedProxy && Boolean(forwardedFor || forwardedHost || forwardedProto);
  const effectiveClientIp =
    usingForwardedHeaders && forwardedFor ? forwardedFor : remoteIp;
  const effectiveHost =
    usingForwardedHeaders && forwardedHost ? forwardedHost : hostHeader;
  const effectiveProto =
    usingForwardedHeaders && forwardedProto ? forwardedProto : defaultProto;

  if (!effectiveHost) {
    return {
      ok: false,
      reason: "missing_host",
      status: proxyConfig.rejectStatus,
    };
  }
  if (
    proxyConfig.allowedPublicHosts.length > 0 &&
    !proxyConfig.allowedPublicHosts.includes(effectiveHost)
  ) {
    return {
      ok: false,
      reason: "host_not_allowed",
      status: proxyConfig.rejectStatus,
    };
  }
  if (proxyConfig.requireHttpsProto && effectiveProto !== "https") {
    return {
      ok: false,
      reason: "proto_not_https",
      status: proxyConfig.rejectStatus,
    };
  }

  return {
    ok: true,
    context: {
      remoteIp,
      clientIp: effectiveClientIp || "unknown",
      host: effectiveHost,
      proto: effectiveProto,
      fromTrustedProxy,
      usingForwardedHeaders,
    },
  };
}
