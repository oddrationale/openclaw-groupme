import {
  createChannelInboundEnvelopeBuilder,
  logInboundDrop,
  toInboundMediaFacts,
} from "openclaw/plugin-sdk/channel-inbound";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { HistoryEntry, ReplyPayload } from "openclaw/plugin-sdk/core";
import { getAgentScopedMediaLocalRoots } from "openclaw/plugin-sdk/media-local-roots";
import { createChannelHistoryWindow } from "openclaw/plugin-sdk/reply-history";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { sanitizeAssistantVisibleText } from "openclaw/plugin-sdk/text-chunking";
import { loadWebMediaRaw } from "openclaw/plugin-sdk/web-media";
import {
  buildGroupMeHistoryEntry,
  formatGroupMeHistoryEntry,
  resolveGroupMeBodyForAgent,
} from "./history.js";
import { normalizeGroupMeAllowEntry } from "./normalize.js";
import { detectGroupMeMention, extractImageUrls } from "./parse.js";
import { getGroupMeRuntime } from "./runtime.js";
import { resolveGroupMeSecurity } from "./security.js";
import {
  GROUPME_MAX_TEXT_LENGTH,
  type GroupMeMediaReadFile,
  sendGroupMeMedia,
  sendGroupMeText,
} from "./send.js";
import type { CoreConfig, GroupMeCallbackData, ResolvedGroupMeAccount } from "./types.js";

const CHANNEL_ID = "groupme" as const;

function resolveTextChunkLimit(account: ResolvedGroupMeAccount): number {
  const configured = account.config.textChunkLimit;
  if (!Number.isFinite(configured)) {
    return GROUPME_MAX_TEXT_LENGTH;
  }
  const value = Math.floor(configured as number);
  if (value <= 0) {
    return GROUPME_MAX_TEXT_LENGTH;
  }
  return Math.min(value, GROUPME_MAX_TEXT_LENGTH);
}

function chunkReplyText(params: {
  text: string;
  limit: number;
  core: ReturnType<typeof getGroupMeRuntime>;
}): string[] {
  const trimmed = params.text.trim();
  if (!trimmed) {
    return [];
  }

  return params.core.channel.text.chunkMarkdownText(trimmed, params.limit).filter(Boolean);
}

/**
 * Reader for agent-generated local media on the direct (non-durable) delivery
 * path, such as block replies. Reads are limited to the agent-scoped media roots
 * OpenClaw grants channels (workspace, media store) and go through the SDK's
 * guarded loader rather than raw filesystem access.
 */
function createAgentMediaReader(params: {
  cfg: OpenClawConfig;
  agentId: string;
  maxBytes: number;
}): GroupMeMediaReadFile {
  const localRoots = getAgentScopedMediaLocalRoots(params.cfg, params.agentId);
  return async (filePath) =>
    (await loadWebMediaRaw(filePath, { maxBytes: params.maxBytes, localRoots })).buffer;
}

async function deliverGroupMeReply(params: {
  payload: ReplyPayload;
  account: ResolvedGroupMeAccount;
  cfg: CoreConfig;
  target: string;
  mediaReadFile: GroupMeMediaReadFile;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<boolean> {
  const { payload, account, cfg, target, mediaReadFile, statusSink } = params;
  const core = getGroupMeRuntime();

  const text = payload.text ?? "";
  const mediaUrls = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  if (!text.trim() && mediaUrls.length === 0) {
    return false;
  }

  const chunks = chunkReplyText({
    text,
    limit: resolveTextChunkLimit(account),
    core,
  });

  const markSent = () => {
    statusSink?.({ lastOutboundAt: Date.now() });
    core.channel.activity.record({
      channel: CHANNEL_ID,
      accountId: account.accountId,
      direction: "outbound",
    });
  };

  const sendTextChunk = async (chunk: string) => {
    await sendGroupMeText({
      cfg,
      to: target,
      text: chunk,
      accountId: account.accountId,
    });
    markSent();
  };

  if (mediaUrls.length === 0) {
    for (const chunk of chunks) {
      await sendTextChunk(chunk);
    }
    return chunks.length > 0;
  }

  const [firstMedia, ...restMedia] = mediaUrls;
  const [firstChunk, ...restChunks] = chunks;

  await sendGroupMeMedia({
    cfg,
    to: target,
    text: firstChunk ?? "",
    mediaUrl: firstMedia,
    mediaReadFile,
    accountId: account.accountId,
  });
  markSent();

  for (const chunk of restChunks) {
    await sendTextChunk(chunk);
  }

  for (const mediaUrl of restMedia) {
    await sendGroupMeMedia({
      cfg,
      to: target,
      text: "",
      mediaUrl,
      mediaReadFile,
      accountId: account.accountId,
    });
    markSent();
  }
  return true;
}

function normalizeAllowFrom(entries: ReadonlyArray<string | number> | undefined): string[] {
  return (entries ?? [])
    .map((entry) => normalizeGroupMeAllowEntry(String(entry)))
    .filter((entry): entry is string => Boolean(entry));
}

export async function handleGroupMeInbound(params: {
  message: GroupMeCallbackData;
  account: ResolvedGroupMeAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  groupHistories: Map<string, HistoryEntry[]>;
  historyLimit: number;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, groupHistories, historyLimit, statusSink } = params;
  const core = getGroupMeRuntime();
  const cfg = config as OpenClawConfig;

  const inboundTimestamp = message.createdAt * 1000;
  statusSink?.({ lastInboundAt: inboundTimestamp });
  core.channel.activity.record({
    channel: CHANNEL_ID,
    accountId: account.accountId,
    direction: "inbound",
    at: inboundTimestamp,
  });

  const security = resolveGroupMeSecurity(account.config);
  const allowFrom = normalizeAllowFrom(account.config.allowFrom);
  const requireMention = account.config.requireMention ?? true;
  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg,
    surface: CHANNEL_ID,
  });
  const hasControlCommand = core.channel.text.hasControlCommand(message.text, cfg);

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: "group",
      id: message.groupId,
    },
  });

  const mentionRegexes = core.channel.mentions.buildMentionRegexes(cfg, route.agentId);
  const wasMentioned = detectGroupMeMention({
    text: message.text,
    botName: account.config.botName,
    channelMentionPatterns: account.config.mentionPatterns,
    mentionRegexes,
  });

  // Core channel ingress owns sender allowlists, control-command authorization,
  // and mention activation. GroupMe maps its settings onto that policy:
  // - an empty `allowFrom` admits every group member; entries switch the group
  //   to an allowlist (a "*" entry admits everyone but still authorizes commands);
  // - control commands require an allowFrom match unless
  //   `security.commandBypass.requireAllowFrom` is false;
  // - authorized commands skip the mention requirement unless
  //   `security.commandBypass.requireMentionForCommands` is true.
  const access = await core.channel.inbound.ingress.resolveStable({
    channelId: CHANNEL_ID,
    accountId: account.accountId,
    cfg,
    identity: {
      key: "groupme-user-id",
      normalize: (value) => normalizeGroupMeAllowEntry(value) || null,
      sensitivity: "pii",
      entryIdPrefix: "groupme-entry",
    },
    subject: { stableId: message.senderId },
    conversation: { kind: "group", id: message.groupId },
    contextBinding: {
      agentId: route.agentId,
      sessionKey: route.sessionKey,
      messageId: message.id,
      inboundEventKind: "user_request",
    },
    groupPolicy: allowFrom.length > 0 ? "allowlist" : "open",
    groupAllowFrom: allowFrom,
    policy: {
      groupAllowFromFallbackToAllowFrom: false,
      activation: {
        requireMention,
        allowTextCommands: allowTextCommands && !security.commandBypass.requireMentionForCommands,
      },
    },
    mentionFacts: {
      canDetectMention: true,
      wasMentioned,
      hasAnyMention: wasMentioned,
    },
    command: {
      allowTextCommands,
      hasControlCommand,
      ...(security.commandBypass.requireAllowFrom
        ? {}
        : { useAccessGroups: false, modeWhenAccessGroupsOff: "allow" as const }),
    },
  });

  if (access.senderAccess.decision !== "allow") {
    runtime.log?.(`groupme: drop sender ${message.senderId} (not in allowFrom)`);
    return;
  }

  if (access.commandAccess.shouldBlockControlCommand) {
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: message.senderId,
    });
    return;
  }

  const imageUrls = extractImageUrls(message.attachments);
  const rawBody = message.text;
  const bodyForAgent = resolveGroupMeBodyForAgent({
    rawBody,
    imageUrls,
  });
  const channelHistory = createChannelHistoryWindow({ historyMap: groupHistories });

  if (access.activationAccess.shouldSkip) {
    const buffered = channelHistory.record({
      historyKey: message.groupId,
      limit: historyLimit,
      entry: buildGroupMeHistoryEntry({
        senderName: message.name,
        body: bodyForAgent,
        timestamp: inboundTimestamp,
        messageId: message.id,
      }),
    });
    if (buffered.length > 0) {
      runtime.log?.(
        `groupme: buffered message from ${message.name} (${buffered.length}/${historyLimit})`,
      );
    } else {
      logInboundDrop({
        log: (line) => runtime.log?.(line),
        channel: CHANNEL_ID,
        reason: "no mention",
        target: message.groupId,
        onceKey: JSON.stringify([account.accountId, message.groupId]),
        hint: "Mention the bot by botName or a mentionPatterns entry, or set requireMention=false to process every message.",
      });
    }
    return;
  }

  if (access.ingress.admission !== "dispatch") {
    runtime.log?.(
      `groupme: drop message ${message.id} (admission=${access.ingress.admission}, reason=${access.ingress.reasonCode})`,
    );
    return;
  }

  const buildEnvelope = createChannelInboundEnvelopeBuilder({ cfg, route });
  const body = buildEnvelope({
    channel: "GroupMe",
    from: message.name,
    timestamp: inboundTimestamp,
    body: bodyForAgent,
  });

  // Snapshot-then-clear the per-group buffer. This block is synchronous (no await
  // between the snapshot and the clear), so it is atomic with respect to other
  // inbound handlers for the same group (handlers run concurrently up to
  // maxConcurrent). Accepted behavior: if two mentions for the same group arrive
  // nearly together, the first handler consumes the buffered context and the
  // second sees an empty buffer rather than re-reading the same entries — buffered
  // context is consumed exactly once, never duplicated. Messages buffered while a
  // reply is in flight are preserved because the clear happens before dispatch.
  const shouldUseHistoryBuffer = requireMention && historyLimit > 0;
  const combinedBody = shouldUseHistoryBuffer
    ? channelHistory.buildPendingContext({
        historyKey: message.groupId,
        limit: historyLimit,
        currentMessage: body,
        formatEntry: formatGroupMeHistoryEntry,
      })
    : body;
  const inboundHistory = shouldUseHistoryBuffer
    ? channelHistory.buildInboundHistory({
        historyKey: message.groupId,
        limit: historyLimit,
      })
    : undefined;
  if (shouldUseHistoryBuffer) {
    channelHistory.clear({
      historyKey: message.groupId,
      limit: historyLimit,
    });
  }

  const target = `groupme:group:${message.groupId}`;
  const mediaReadFile = createAgentMediaReader({
    cfg,
    agentId: route.agentId,
    maxBytes: security.media.maxDownloadBytes,
  });
  const commandAuthorized = access.commandAccess.authorized;
  const ctxPayload = core.channel.inbound.buildContext({
    channelIngress: access,
    channel: CHANNEL_ID,
    accountId: route.accountId,
    messageId: message.id,
    timestamp: inboundTimestamp,
    from: `groupme:user:${message.senderId}`,
    sender: {
      id: message.senderId,
      name: message.name,
    },
    conversation: {
      kind: "group",
      id: message.groupId,
      label: `groupme:${message.groupId}`,
    },
    route: {
      agentId: route.agentId,
      dmScope: route.dmScope,
      accountId: route.accountId,
      routeSessionKey: route.sessionKey,
    },
    reply: {
      to: target,
      originatingTo: target,
    },
    message: {
      body: combinedBody,
      bodyForAgent,
      rawBody,
      commandBody: rawBody,
      inboundHistory,
    },
    access: {
      commands: { authorized: commandAuthorized },
      mentions: {
        canDetectMention: true,
        wasMentioned: access.activationAccess.effectiveWasMentioned ?? wasMentioned,
      },
    },
    media: toInboundMediaFacts(
      imageUrls.map((url) => ({ url, kind: "image" as const, messageId: message.id })),
    ),
    extra: {
      GroupSpace: message.groupId,
    },
  });

  await core.channel.inbound.dispatch({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route: { agentId: route.agentId, dmScope: route.dmScope, sessionKey: route.sessionKey },
    ctxPayload,
    delivery: {
      preparePayload: (payload) =>
        payload.text === undefined
          ? payload
          : { ...payload, text: sanitizeAssistantVisibleText(payload.text) },
      // Prefer core's durable outbound queue (retries survive restarts). Core
      // falls back to `deliver` when durable delivery does not handle a payload.
      durable: () => ({ to: target }),
      deliver: async (payload) => {
        const visibleReplySent = await deliverGroupMeReply({
          payload,
          account,
          cfg: config,
          target,
          mediaReadFile,
          statusSink,
        });
        return { visibleReplySent };
      },
      onError: (err, info) => {
        runtime.error?.(`groupme ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyPipeline: {},
    replyOptions: {
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
    record: {
      onRecordError: (err) => {
        runtime.error?.(`groupme: failed updating session meta: ${String(err)}`);
      },
    },
  });
}
