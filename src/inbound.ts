import type {
  OpenClawConfig,
  ReplyPayload,
  RuntimeEnv,
} from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  clearHistoryEntriesIfEnabled,
  createReplyPrefixOptions,
  logInboundDrop,
  recordPendingHistoryEntryIfEnabled,
  resolveControlCommandGate,
  resolveMentionGatingWithBypass,
  type HistoryEntry,
} from "openclaw/plugin-sdk";
import type {
  GroupMeCallbackData,
  ResolvedGroupMeAccount,
  CoreConfig,
} from "./types.js";
import {
  buildGroupMeHistoryEntry,
  formatGroupMeHistoryEntry,
  resolveGroupMeBodyForAgent,
} from "./history.js";
import { extractImageUrls, detectGroupMeMention } from "./parse.js";
import { resolveSenderAccess } from "./policy.js";
import { getGroupMeRuntime } from "./runtime.js";
import {
  GROUPME_MAX_TEXT_LENGTH,
  sendGroupMeMedia,
  sendGroupMeText,
} from "./send.js";
import { resolveGroupMeSecurity } from "./security.js";

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

  return params.core.channel.text
    .chunkMarkdownText(trimmed, params.limit)
    .filter(Boolean);
}

async function deliverGroupMeReply(params: {
  payload: ReplyPayload;
  account: ResolvedGroupMeAccount;
  cfg: CoreConfig;
  target: string;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}) {
  const { payload, account, cfg, target, statusSink } = params;
  const core = getGroupMeRuntime();

  const text = payload.text ?? "";
  const mediaUrls = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  if (!text.trim() && mediaUrls.length === 0) {
    return;
  }

  const chunks = chunkReplyText({
    text,
    limit: resolveTextChunkLimit(account),
    core,
  });

  const sendTextChunk = async (chunk: string) => {
    await sendGroupMeText({
      cfg,
      to: target,
      text: chunk,
      accountId: account.accountId,
    });
    statusSink?.({ lastOutboundAt: Date.now() });
    core.channel.activity.record({
      channel: CHANNEL_ID,
      accountId: account.accountId,
      direction: "outbound",
    });
  };

  if (mediaUrls.length === 0) {
    for (const chunk of chunks) {
      await sendTextChunk(chunk);
    }
    return;
  }

  const [firstMedia, ...restMedia] = mediaUrls;
  const [firstChunk, ...restChunks] = chunks;

  await sendGroupMeMedia({
    cfg,
    to: target,
    text: firstChunk ?? "",
    mediaUrl: firstMedia,
    accountId: account.accountId,
  });
  statusSink?.({ lastOutboundAt: Date.now() });
  core.channel.activity.record({
    channel: CHANNEL_ID,
    accountId: account.accountId,
    direction: "outbound",
  });

  for (const chunk of restChunks) {
    await sendTextChunk(chunk);
  }

  for (const mediaUrl of restMedia) {
    await sendGroupMeMedia({
      cfg,
      to: target,
      text: "",
      mediaUrl,
      accountId: account.accountId,
    });
    statusSink?.({ lastOutboundAt: Date.now() });
    core.channel.activity.record({
      channel: CHANNEL_ID,
      accountId: account.accountId,
      direction: "outbound",
    });
  }
}

export async function handleGroupMeInbound(params: {
  message: GroupMeCallbackData;
  account: ResolvedGroupMeAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  groupHistories: Map<string, HistoryEntry[]>;
  historyLimit: number;
  statusSink?: (patch: {
    lastInboundAt?: number;
    lastOutboundAt?: number;
  }) => void;
}): Promise<void> {
  const {
    message,
    account,
    config,
    runtime,
    groupHistories,
    historyLimit,
    statusSink,
  } = params;
  const core = getGroupMeRuntime();

  const inboundTimestamp = message.createdAt * 1000;
  statusSink?.({ lastInboundAt: inboundTimestamp });
  core.channel.activity.record({
    channel: CHANNEL_ID,
    accountId: account.accountId,
    direction: "inbound",
    at: inboundTimestamp,
  });

  const allowFrom = account.config.allowFrom ?? [];
  const security = resolveGroupMeSecurity(account.config);
  const senderAllowed = resolveSenderAccess({
    senderId: message.senderId,
    allowFrom,
  });
  if (!senderAllowed) {
    runtime.log?.(
      `groupme: drop sender ${message.senderId} (not in allowFrom)`,
    );
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: "group",
      id: message.groupId,
    },
  });

  const mentionRegexes = core.channel.mentions.buildMentionRegexes(
    config as OpenClawConfig,
    route.agentId,
  );
  const requireMention = account.config.requireMention ?? true;
  const wasMentioned = detectGroupMeMention({
    text: message.text,
    botName: account.config.botName,
    channelMentionPatterns: account.config.mentionPatterns,
    mentionRegexes,
  });

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const hasControlCommand = core.channel.text.hasControlCommand(
    message.text,
    config as OpenClawConfig,
  );
  const commandBypassNeedsAllowFrom =
    security.commandBypass.requireAllowFrom && hasControlCommand;
  const commandBypassCanSkipMention = !(
    security.commandBypass.requireMentionForCommands &&
    requireMention &&
    hasControlCommand
  );

  const commandGate = resolveControlCommandGate({
    useAccessGroups:
      config.commands?.useAccessGroups !== false || commandBypassNeedsAllowFrom,
    authorizers: [{ configured: allowFrom.length > 0, allowed: senderAllowed }],
    allowTextCommands,
    hasControlCommand,
  });
  if (commandGate.shouldBlock) {
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: message.senderId,
    });
    return;
  }

  const mentionGate = resolveMentionGatingWithBypass({
    isGroup: true,
    requireMention,
    canDetectMention: true,
    wasMentioned,
    hasAnyMention: false,
    allowTextCommands,
    hasControlCommand: commandBypassCanSkipMention ? hasControlCommand : false,
    commandAuthorized: commandBypassCanSkipMention
      ? commandGate.commandAuthorized
      : false,
  });

  const imageUrls = extractImageUrls(message.attachments);
  const rawBody = message.text;
  const bodyForAgent = resolveGroupMeBodyForAgent({
    rawBody,
    imageUrls,
  });

  if (mentionGate.shouldSkip) {
    const buffered = recordPendingHistoryEntryIfEnabled({
      historyMap: groupHistories,
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
      runtime.log?.("groupme: skip message (mention required, not mentioned)");
    }
    return;
  }

  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(
    config as OpenClawConfig,
  );
  const storePath = core.channel.session.resolveStorePath(
    config.session?.store,
    {
      agentId: route.agentId,
    },
  );
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "GroupMe",
    from: message.name,
    timestamp: inboundTimestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: bodyForAgent,
  });
  const shouldUseHistoryBuffer = requireMention && historyLimit > 0;
  const historyEntriesForContext = shouldUseHistoryBuffer
    ? [...(groupHistories.get(message.groupId) ?? [])]
    : [];
  if (shouldUseHistoryBuffer) {
    clearHistoryEntriesIfEnabled({
      historyMap: groupHistories,
      historyKey: message.groupId,
      limit: historyLimit,
    });
  }

  const combinedBody =
    shouldUseHistoryBuffer
      ? buildPendingHistoryContextFromMap({
          historyMap: new Map([[message.groupId, historyEntriesForContext]]),
          historyKey: message.groupId,
          limit: historyLimit,
          currentMessage: body,
          formatEntry: formatGroupMeHistoryEntry,
        })
      : body;
  const inboundHistory =
    shouldUseHistoryBuffer
      ? historyEntriesForContext.map((entry) => ({
          sender: entry.sender,
          body: entry.body,
          timestamp: entry.timestamp,
        }))
      : undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: combinedBody,
    BodyForAgent: bodyForAgent,
    InboundHistory: inboundHistory,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `groupme:user:${message.senderId}`,
    To: `groupme:group:${message.groupId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "group",
    ConversationLabel: `groupme:${message.groupId}`,
    SenderName: message.name,
    SenderId: message.senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: mentionGate.effectiveWasMentioned,
    MessageSid: message.id,
    Timestamp: inboundTimestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `groupme:group:${message.groupId}`,
    CommandAuthorized: commandGate.commandAuthorized,
    MediaUrl: imageUrls[0],
    MediaUrls: imageUrls.length > 0 ? imageUrls : undefined,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`groupme: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config as OpenClawConfig,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config as OpenClawConfig,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        await deliverGroupMeReply({
          payload,
          account,
          cfg: config,
          target: `groupme:group:${message.groupId}`,
          statusSink,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`groupme ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onModelSelected,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}
