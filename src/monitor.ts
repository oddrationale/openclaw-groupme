import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { readJsonBodyWithLimit, requestBodyErrorToText } from "openclaw/plugin-sdk";
import type { CoreConfig, ResolvedGroupMeAccount } from "./types.js";
import { handleGroupMeInbound } from "./inbound.js";
import { parseGroupMeCallback, shouldProcessCallback } from "./parse.js";

export type GroupMeWebhookHandlerParams = {
  account: ResolvedGroupMeAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export function createGroupMeWebhookHandler(
  params: GroupMeWebhookHandlerParams,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return;
    }

    const body = await readJsonBodyWithLimit(req, {
      maxBytes: 64 * 1024,
      timeoutMs: 15_000,
      emptyObjectOnEmpty: false,
    });
    if (!body.ok) {
      res.statusCode =
        body.code === "PAYLOAD_TOO_LARGE" ? 413 : body.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
      res.end(body.code === "INVALID_JSON" ? body.error : requestBodyErrorToText(body.code));
      return;
    }

    res.statusCode = 200;
    res.end("ok");

    const message = parseGroupMeCallback(body.value);
    if (!message) {
      params.runtime.log?.("groupme: unparseable callback payload");
      return;
    }

    const ignoreReason = shouldProcessCallback(message);
    if (ignoreReason) {
      params.runtime.log?.(`groupme: ignoring message (${ignoreReason})`);
      return;
    }

    void handleGroupMeInbound({
      message,
      account: params.account,
      config: params.config,
      runtime: params.runtime,
      statusSink: params.statusSink,
    }).catch((err) => {
      params.runtime.error?.(`groupme: inbound processing failed: ${String(err)}`);
    });
  };
}
