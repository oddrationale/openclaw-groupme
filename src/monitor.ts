import type { IncomingMessage, ServerResponse } from "node:http";
import type { HistoryEntry } from "openclaw/plugin-sdk";
import type { RuntimeEnv } from "openclaw/plugin-sdk";
import {
  readJsonBodyWithLimit,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk";
import { resolveGroupMeHistoryLimit } from "./history.js";
import { handleGroupMeInbound } from "./inbound.js";
import { parseGroupMeCallback, shouldProcessCallback } from "./parse.js";
import { GroupMeRateLimiter } from "./rate-limit.js";
import { GroupMeReplayCache, buildReplayKey } from "./replay-cache.js";
import {
  checkGroupBinding,
  redactCallbackUrl,
  resolveGroupMeSecurity,
  validateProxyRequest,
  type ResolvedGroupMeSecurity,
  verifyCallbackAuth,
} from "./security.js";
import type {
  CoreConfig,
  ResolvedGroupMeAccount,
  WebhookDecision,
} from "./types.js";

export type GroupMeWebhookHandlerParams = {
  account: ResolvedGroupMeAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: {
    lastInboundAt?: number;
    lastOutboundAt?: number;
  }) => void;
};

function rejectDecision(params: {
  status: number;
  reason: string;
  logLevel?: "debug" | "warn";
}): WebhookDecision {
  return {
    kind: "reject",
    status: params.status,
    reason: params.reason,
    logLevel: params.logLevel ?? "warn",
  };
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  413: "Payload Too Large",
  429: "Too Many Requests",
};

function formatRejectionBody(status: number): string {
  return STATUS_TEXT[status] ?? "rejected";
}

function asRequestBodyErrorCode(
  value: string,
): "PAYLOAD_TOO_LARGE" | "REQUEST_BODY_TIMEOUT" | "CONNECTION_CLOSED" | null {
  if (
    value === "PAYLOAD_TOO_LARGE" ||
    value === "REQUEST_BODY_TIMEOUT" ||
    value === "CONNECTION_CLOSED"
  ) {
    return value;
  }
  return null;
}

function logWebhookRejection(params: {
  runtime: RuntimeEnv;
  security: ResolvedGroupMeSecurity;
  decision: Extract<WebhookDecision, { kind: "reject" }>;
  reqUrl: URL;
}) {
  if (!params.security.logging.logRejectedRequests) {
    return;
  }
  const url = params.security.logging.redactSecrets
    ? redactCallbackUrl(
        `${params.reqUrl.pathname}${params.reqUrl.search}`,
        params.security,
      )
    : `${params.reqUrl.pathname}${params.reqUrl.search}`;
  const line = `groupme: webhook rejected (${params.decision.reason}) status=${params.decision.status} url=${url}`;
  if (params.decision.logLevel === "warn") {
    params.runtime.error?.(line);
    return;
  }
  params.runtime.log?.(line);
}

async function decideWebhookRequest(params: {
  req: IncomingMessage;
  security: ResolvedGroupMeSecurity;
  replayCache: GroupMeReplayCache;
  rateLimiter: GroupMeRateLimiter;
}): Promise<WebhookDecision> {
  const reqUrl = new URL(params.req.url ?? "/", "http://localhost");

  if (params.req.method !== "POST") {
    return rejectDecision({
      status: 405,
      reason: "invalid_method",
      logLevel: "debug",
    });
  }

  const auth = verifyCallbackAuth({ url: reqUrl, security: params.security });
  if (!auth.ok && auth.reason !== "disabled") {
    return rejectDecision({
      status: params.security.callbackRejectStatus,
      reason: `auth_${auth.reason}`,
      logLevel: "warn",
    });
  }

  const proxyValidation = validateProxyRequest({
    headers: params.req.headers,
    remoteAddress: params.req.socket.remoteAddress ?? "",
    socketEncrypted: Boolean((params.req.socket as { encrypted?: boolean }).encrypted),
    security: params.security,
  });
  if (!proxyValidation.ok) {
    return rejectDecision({
      status: proxyValidation.status,
      reason: `proxy_${proxyValidation.reason}`,
      logLevel: "warn",
    });
  }

  const body = await readJsonBodyWithLimit(params.req, {
    maxBytes: 64 * 1024,
    timeoutMs: 15_000,
    emptyObjectOnEmpty: false,
  });
  if (!body.ok) {
    return rejectDecision({
      status:
        body.code === "PAYLOAD_TOO_LARGE"
          ? 413
          : body.code === "REQUEST_BODY_TIMEOUT"
            ? 408
            : 400,
      reason: `body_${body.code.toLowerCase()}`,
      logLevel: "debug",
    });
  }

  const message = parseGroupMeCallback(body.value);
  if (!message) {
    return rejectDecision({
      status: 400,
      reason: "parse_invalid_callback",
      logLevel: "debug",
    });
  }

  const ignoreReason = shouldProcessCallback(message);
  if (ignoreReason) {
    return rejectDecision({
      status: 200,
      reason: `ignore_${ignoreReason.replace(/\s+/g, "_")}`,
      logLevel: "debug",
    });
  }

  const groupBinding = checkGroupBinding({
    expectedGroupId: params.security.expectedGroupId,
    inboundGroupId: message.groupId,
  });
  if (!groupBinding.ok) {
    return rejectDecision({
      status: 403,
      reason: "group_binding_mismatch",
      logLevel: "warn",
    });
  }

  if (params.security.replay.enabled) {
    const replay = params.replayCache.checkAndRemember(buildReplayKey(message));
    if (replay.kind === "duplicate") {
      return rejectDecision({
        status: 200,
        reason: "duplicate_replay",
        logLevel: "debug",
      });
    }
  }

  if (!params.security.rateLimit.enabled) {
    return { kind: "accept", message, release: () => undefined };
  }

  const rate = params.rateLimiter.evaluate({
    ip: proxyValidation.context.clientIp,
    senderId: message.senderId,
  });
  if (rate.kind === "rejected") {
    return rejectDecision({
      status: 429,
      reason: `rate_limited_${rate.scope}`,
      logLevel: "warn",
    });
  }

  return { kind: "accept", message, release: rate.release };
}

export function createGroupMeWebhookHandler(
  params: GroupMeWebhookHandlerParams,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const groupHistories = new Map<string, HistoryEntry[]>();
  const historyLimit = resolveGroupMeHistoryLimit(
    params.account.config.historyLimit,
  );
  const security = resolveGroupMeSecurity(params.account.config);
  const replayCache = new GroupMeReplayCache({
    ttlSeconds: security.replay.ttlSeconds,
    maxEntries: security.replay.maxEntries,
  });
  const rateLimiter = new GroupMeRateLimiter({
    windowMs: security.rateLimit.windowMs,
    maxRequestsPerIp: security.rateLimit.maxRequestsPerIp,
    maxRequestsPerSender: security.rateLimit.maxRequestsPerSender,
    maxConcurrent: security.rateLimit.maxConcurrent,
  });

  return async (req, res) => {
    const decision = await decideWebhookRequest({
      req,
      security,
      replayCache,
      rateLimiter,
    });

    if (decision.kind === "reject") {
      const reqUrl = new URL(req.url ?? "/", "http://localhost");
      logWebhookRejection({
        runtime: params.runtime,
        security,
        decision,
        reqUrl,
      });

      if (decision.status === 405) {
        res.setHeader("Allow", "POST");
      }
      res.statusCode = decision.status;
      if (decision.status === 200) {
        res.end("ok");
        return;
      }
      if (decision.reason.startsWith("body_")) {
        const code = decision.reason.slice("body_".length).toUpperCase();
        if (code === "INVALID_JSON") {
          res.end("Invalid JSON");
          return;
        }
        const requestBodyErrorCode = asRequestBodyErrorCode(code);
        if (requestBodyErrorCode) {
          res.end(
            requestBodyErrorToText(requestBodyErrorCode),
          );
          return;
        }
      }
      res.end(formatRejectionBody(decision.status));
      return;
    }

    const { message, release } = decision;
    res.statusCode = 200;
    res.end("ok");

    void handleGroupMeInbound({
      message,
      account: params.account,
      config: params.config,
      runtime: params.runtime,
      statusSink: params.statusSink,
      groupHistories,
      historyLimit,
    })
      .catch((err) => {
        params.runtime.error?.(
          `groupme: inbound processing failed: ${String(err)}`,
        );
      })
      .finally(() => {
        release();
      });
  };
}
