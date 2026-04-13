import {
  type ChannelPlugin,
} from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { missingTargetError } from "openclaw/plugin-sdk/channel-feedback";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-targets";
import type { CoreConfig, GroupMeProbe, ResolvedGroupMeAccount } from "./types.js";
import { resolveGroupMeAccount } from "./accounts.js";
import {
  CHANNEL_ID,
  groupmeChannelPluginCommon,
  redactWebhookPath,
} from "./channel-shared.js";
import { createGroupMeWebhookHandler } from "./monitor.js";
import {
  normalizeGroupMeAllowEntry,
  normalizeGroupMeTarget,
  looksLikeGroupMeTargetId,
} from "./normalize.js";
import {
  GROUPME_MAX_TEXT_LENGTH,
  sendGroupMeMedia,
  sendGroupMeText,
} from "./send.js";
import { getGroupMeRuntime } from "./runtime.js";

function normalizeCallbackUrl(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return "/groupme";
  }
  try {
    const parsed = new URL(trimmed, "http://localhost");
    return parsed.pathname || "/groupme";
  } catch {
    const noQuery = trimmed.split("?")[0] ?? trimmed;
    if (!noQuery) {
      return "/groupme";
    }
    return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  }
}

export const groupmePlugin: ChannelPlugin<
  ResolvedGroupMeAccount,
  GroupMeProbe
> = {
  id: CHANNEL_ID,
  ...groupmeChannelPluginCommon,
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) =>
      getGroupMeRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: GROUPME_MAX_TEXT_LENGTH,
    resolveTarget: ({ to }) => {
      const normalized = normalizeGroupMeTarget(to?.trim() ?? "");
      if (!normalized) {
        return {
          ok: false,
          error: missingTargetError("GroupMe", "<group-id>"),
        };
      }

      return {
        ok: true,
        to: normalized,
      };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const result = await sendGroupMeText({
        cfg: cfg as CoreConfig,
        to,
        text,
        accountId,
      });
      return {
        channel: CHANNEL_ID,
        messageId: result.messageId,
        timestamp: result.timestamp,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      if (!mediaUrl?.trim()) {
        throw new Error("GroupMe media send requires a mediaUrl");
      }

      const result = await sendGroupMeMedia({
        cfg: cfg as CoreConfig,
        to,
        text,
        mediaUrl,
        accountId,
      });
      return {
        channel: CHANNEL_ID,
        messageId: result.messageId,
        timestamp: result.timestamp,
      };
    },
  },
  messaging: {
    normalizeTarget: normalizeGroupMeTarget,
    targetResolver: {
      looksLikeId: (raw) => looksLikeGroupMeTargetId(raw),
      hint: "<group-id>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeGroupMeTarget(input);
        if (!normalized) {
          return {
            input,
            resolved: false,
            note: "empty target",
          };
        }

        return {
          input,
          resolved: true,
          id: normalized,
          name: normalized,
          note: kind === "user" ? "GroupMe bots are group-only" : undefined,
        };
      });
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveGroupMeAccount({
        cfg: cfg as CoreConfig,
        accountId,
      });
      const q = query?.trim().toLowerCase() ?? "";
      return (account.config.allowFrom ?? [])
        .map((entry) => normalizeGroupMeAllowEntry(String(entry)))
        .filter((entry): entry is string => Boolean(entry) && entry !== "*")
        .filter((entry) => (q ? entry.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }) as const);
    },
    listGroups: async () => [],
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      callbackUrl: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      botId: account.botId ? "***" : "",
      tokenSource: account.accessToken ? "configured" : "none",
      webhookPath: redactWebhookPath(account, account.config.callbackUrl),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      lastError: runtime?.lastError ?? null,
      mode: "webhook",
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(
          `GroupMe is not configured for account "${account.accountId}" (missing botId).`,
        );
      }

      const callbackPath = normalizeCallbackUrl(account.config.callbackUrl);
      const redactedCallbackPath = redactWebhookPath(
        account,
        account.config.callbackUrl ?? callbackPath,
      );
      const unregister = registerPluginHttpRoute({
        path: callbackPath,
        fallbackPath: "/groupme",
        handler: createGroupMeWebhookHandler({
          account,
          config: ctx.cfg as CoreConfig,
          runtime: ctx.runtime,
          statusSink: (patch) =>
            ctx.setStatus({ accountId: account.accountId, ...patch }),
        }),
        auth: "plugin",
        pluginId: CHANNEL_ID,
        accountId: account.accountId,
        log: (message) => ctx.log?.info(message),
      });

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        mode: "webhook",
        webhookPath: redactedCallbackPath,
        lastStartAt: Date.now(),
        lastError: null,
      });

      ctx.log?.info(
        `[${account.accountId}] GroupMe webhook listening on ${redactedCallbackPath}`,
      );

      if (ctx.abortSignal.aborted) {
        unregister();
        return;
      }

      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener(
          "abort",
          () => {
            unregister();
            resolve();
          },
          { once: true },
        );
      });
    },
  },
};
