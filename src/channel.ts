import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { missingTargetError } from "openclaw/plugin-sdk/channel-feedback";
import {
  type ChannelMessageSendMediaContext,
  type ChannelMessageSendTextContext,
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
  type MessageReceipt,
  type MessageReceiptPartKind,
  waitUntilAbort,
} from "openclaw/plugin-sdk/channel-outbound";
import {
  channelBlockedPatch,
  channelReadyPatch,
  channelStoppedPatch,
} from "openclaw/plugin-sdk/gateway-runtime";
import { createDefaultChannelRuntimeState } from "openclaw/plugin-sdk/status-helpers";
import {
  chunkTextForOutbound,
  sanitizeAssistantVisibleText,
} from "openclaw/plugin-sdk/text-chunking";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import { hasSecretInput, resolveGroupMeAccount } from "./accounts.js";
import { CHANNEL_ID, groupmeSetupPlugin } from "./channel.setup.js";
import { createGroupMeWebhookHandler } from "./monitor.js";
import {
  looksLikeGroupMeTargetId,
  normalizeGroupMeAllowEntry,
  normalizeGroupMeTarget,
} from "./normalize.js";
import { resolveGroupMeSecurity } from "./security.js";
import { GROUPME_MAX_TEXT_LENGTH, sendGroupMeMedia, sendGroupMeText } from "./send.js";
import type { CoreConfig, GroupMeProbe, ResolvedGroupMeAccount } from "./types.js";
import { DEFAULT_GROUPME_WEBHOOK_PATH, normalizeWebhookPath } from "./webhook-path.js";

type GroupMeSendResult = {
  channel: typeof CHANNEL_ID;
  messageId: string;
  timestamp: number;
  target: { kind: "chat"; id: string };
  receipt: MessageReceipt;
};

type GroupMeTextContext = Omit<ChannelMessageSendTextContext, "onDeliveryResult">;
type GroupMeMediaContext = Omit<ChannelMessageSendMediaContext, "onDeliveryResult">;

function createGroupMeSendResult(params: {
  groupId: string;
  kind: MessageReceiptPartKind;
  timestamp: number;
}): GroupMeSendResult {
  return {
    channel: CHANNEL_ID,
    // The Bot API returns 202 with no body. Keep the receipt empty so a group id
    // or a random value never masquerades as a platform message id.
    messageId: "",
    timestamp: params.timestamp,
    target: { kind: "chat", id: params.groupId },
    receipt: createMessageReceiptFromOutboundResults({
      results: [],
      threadId: params.groupId,
      kind: params.kind,
    }),
  };
}

async function sendGroupMeTextMessage(ctx: GroupMeTextContext): Promise<GroupMeSendResult> {
  const result = await sendGroupMeText({
    cfg: ctx.cfg as CoreConfig,
    to: ctx.to,
    text: ctx.text,
    accountId: ctx.accountId,
    onPlatformSendDispatch: ctx.onPlatformSendDispatch,
    assertDirectAdapterHandoff: ctx.assertDirectAdapterHandoff,
    signal: ctx.signal,
  });
  return createGroupMeSendResult({ groupId: ctx.to, kind: "text", timestamp: result.timestamp });
}

async function sendGroupMeMediaMessage(ctx: GroupMeMediaContext): Promise<GroupMeSendResult> {
  if (!ctx.mediaUrl?.trim()) {
    throw new Error("GroupMe media send requires a mediaUrl");
  }
  const result = await sendGroupMeMedia({
    cfg: ctx.cfg as CoreConfig,
    to: ctx.to,
    text: ctx.text,
    mediaUrl: ctx.mediaUrl,
    mediaReadFile: ctx.mediaReadFile,
    accountId: ctx.accountId,
    onPlatformSendDispatch: ctx.onPlatformSendDispatch,
    assertDirectAdapterHandoff: ctx.assertDirectAdapterHandoff,
    signal: ctx.signal,
  });
  return createGroupMeSendResult({ groupId: ctx.to, kind: "media", timestamp: result.timestamp });
}

const groupmeMessageAdapter = defineChannelMessageAdapter({
  id: CHANNEL_ID,
  durableFinal: {
    capabilities: {
      text: true,
      media: true,
    },
  },
  send: {
    text: sendGroupMeTextMessage,
    media: sendGroupMeMediaMessage,
  },
});

function collectGroupMeWarnings(account: ResolvedGroupMeAccount): string[] {
  const warnings: string[] = [];
  // Audits may pass an unresolved account, so check secret inputs (which can be
  // SecretRefs) rather than resolved string values.
  const config = account.config ?? {};
  const security = resolveGroupMeSecurity(config);
  if (!hasSecretInput(config.callbackToken)) {
    warnings.push(
      "- GroupMe: callbackToken is not configured. Inbound callbacks are not token-authenticated; anyone who learns the webhook path and group_id can post. Set callbackToken and append ?k=<token> to the bot callback URL.",
    );
  }
  if (!security.groupId) {
    warnings.push(
      "- GroupMe: groupId is not configured. Every inbound callback is rejected until groupId is set.",
    );
  }
  if (!hasSecretInput(config.accessToken)) {
    warnings.push(
      "- GroupMe: accessToken is not configured. Text replies work, but image replies cannot be uploaded.",
    );
  }
  if (!security.commandBypass.requireAllowFrom) {
    warnings.push(
      "- GroupMe: security.commandBypass.requireAllowFrom=false lets any group member run control commands.",
    );
  }
  return warnings;
}

export const groupmePlugin = {
  ...groupmeSetupPlugin,
  groups: {
    resolveRequireMention: ({ cfg, accountId }) => {
      const account = resolveGroupMeAccount({
        cfg: cfg as CoreConfig,
        accountId,
      });
      return account.config.requireMention ?? true;
    },
  },
  agentPrompt: {
    inboundFormattingHints: () => ({
      text_markup: "plain",
      rules: [
        "GroupMe renders plain text only: Markdown such as **bold**, headings, tables, and code fences shows up literally.",
        `Keep each message under ${GROUPME_MAX_TEXT_LENGTH} characters; longer replies are split into several messages.`,
        "Paste links as bare URLs. Images can be attached as media; other file types cannot.",
      ],
    }),
  },
  security: {
    collectWarnings: ({ account }) => collectGroupMeWarnings(account),
  },
  message: groupmeMessageAdapter,
  outbound: {
    deliveryMode: "direct",
    chunker: chunkTextForOutbound,
    chunkerMode: "markdown",
    textChunkLimit: GROUPME_MAX_TEXT_LENGTH,
    sanitizeText: ({ text }) => sanitizeAssistantVisibleText(text),
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
    sendText: sendGroupMeTextMessage,
    sendMedia: async (ctx) => {
      if (!ctx.mediaUrl?.trim()) {
        throw new Error("GroupMe media send requires a mediaUrl");
      }
      return await sendGroupMeMediaMessage({ ...ctx, mediaUrl: ctx.mediaUrl });
    },
  },
  messaging: {
    targetPrefixes: ["groupme"],
    normalizeTarget: normalizeGroupMeTarget,
    inferTargetChatType: ({ to }) => (looksLikeGroupMeTargetId(to) ? "group" : undefined),
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
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
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
      botId: hasSecretInput(account.config.botId) ? "***" : "",
      tokenSource: hasSecretInput(account.config.accessToken) ? "configured" : "none",
      webhookPath: normalizeWebhookPath(account.config.webhookPath),
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
        // Stay parked until stopped: resolving (or throwing) here would make the
        // gateway restart the account in a loop without a usable bot id.
        ctx.log?.warn?.(
          `[${account.accountId}] GroupMe is not configured (missing botId); webhook not registered`,
        );
        ctx.setStatus(
          channelBlockedPatch(
            `GroupMe is not configured for account "${account.accountId}" (missing botId).`,
            { accountId: account.accountId, running: false },
          ),
        );
        return waitUntilAbort(ctx.abortSignal);
      }

      const callbackPath = normalizeWebhookPath(account.config.webhookPath);
      const unregister = registerPluginHttpRoute({
        path: callbackPath,
        fallbackPath: DEFAULT_GROUPME_WEBHOOK_PATH,
        handler: createGroupMeWebhookHandler({
          account,
          config: ctx.cfg as CoreConfig,
          runtime: ctx.runtime,
          // Thin setStatus adapter; exercised end-to-end through the live gateway, not in
          // unit isolation (the webhook-flow tests drive the handler with their own sink).
          /* v8 ignore next */
          statusSink: (patch) => ctx.setStatus({ accountId: account.accountId, ...patch }),
        }),
        auth: "plugin",
        pluginId: CHANNEL_ID,
        accountId: account.accountId,
        log: (message) => ctx.log?.info(message),
      });

      ctx.setStatus(
        channelReadyPatch({
          accountId: account.accountId,
          mode: "webhook",
          webhookPath: callbackPath,
          lastStartAt: Date.now(),
        }),
      );
      ctx.log?.info(`[${account.accountId}] GroupMe webhook listening on ${callbackPath}`);

      // Resolving before abort would make the gateway restart this account.
      return waitUntilAbort(ctx.abortSignal, () => {
        unregister();
        ctx.setStatus(
          channelStoppedPatch({
            accountId: account.accountId,
            lastStopAt: Date.now(),
          }),
        );
      });
    },
  },
} satisfies ChannelPlugin<ResolvedGroupMeAccount, GroupMeProbe>;
