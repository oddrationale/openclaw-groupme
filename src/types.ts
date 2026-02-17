import type {
  BlockStreamingCoalesceConfig,
  MarkdownConfig,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

export type GroupMeAllowFromEntry = string | number;

export type GroupMeReplayConfig = {
  ttlSeconds?: number;
  maxEntries?: number;
};

export type GroupMeRateLimitConfig = {
  windowMs?: number;
  maxRequestsPerIp?: number;
  maxRequestsPerSender?: number;
  maxConcurrent?: number;
};

export type GroupMeMediaSecurityConfig = {
  allowPrivateNetworks?: boolean;
  maxDownloadBytes?: number;
  requestTimeoutMs?: number;
  allowedMimePrefixes?: string[];
};

export type GroupMeLoggingSecurityConfig = {
  redactSecrets?: boolean;
  logRejectedRequests?: boolean;
};

export type GroupMeCommandBypassSecurityConfig = {
  requireAllowFrom?: boolean;
  requireMentionForCommands?: boolean;
};

export type GroupMeProxySecurityConfig = {
  trustedProxyCidrs?: string[];
  allowedPublicHosts?: string[];
  requireHttpsProto?: boolean;
  rejectStatus?: 400 | 403 | 404;
};

export type GroupMeSecurityConfig = {
  replay?: GroupMeReplayConfig;
  rateLimit?: GroupMeRateLimitConfig;
  media?: GroupMeMediaSecurityConfig;
  logging?: GroupMeLoggingSecurityConfig;
  commandBypass?: GroupMeCommandBypassSecurityConfig;
  proxy?: GroupMeProxySecurityConfig;
};

export type GroupMeAccountConfig = {
  name?: string;
  enabled?: boolean;
  botId?: string;
  accessToken?: string;
  botName?: string;
  groupId?: string;
  publicDomain?: string;
  callbackUrl?: string;
  mentionPatterns?: string[];
  requireMention?: boolean;
  historyLimit?: number;
  allowFrom?: GroupMeAllowFromEntry[];
  markdown?: MarkdownConfig;
  textChunkLimit?: number;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  responsePrefix?: string;
  mediaMaxMb?: number;
  security?: GroupMeSecurityConfig;
};

export type GroupMeConfig = GroupMeAccountConfig & {
  accounts?: Record<string, GroupMeAccountConfig | undefined>;
  defaultAccount?: string;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    groupme?: GroupMeConfig;
  };
};

export type ResolvedGroupMeAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  botId: string;
  accessToken: string;
  config: GroupMeAccountConfig;
};

export type GroupMeImageAttachment = {
  type: "image";
  url: string;
};

export type GroupMeLocationAttachment = {
  type: "location";
  lat: string;
  lng: string;
  name: string;
};

export type GroupMeMentionsAttachment = {
  type: "mentions";
  user_ids: string[];
  loci: number[][];
};

export type GroupMeEmojiAttachment = {
  type: "emoji";
  placeholder: string;
  charmap: number[][];
};

export type GroupMeUnknownAttachment = {
  type: string;
  [key: string]: unknown;
};

export type GroupMeAttachment =
  | GroupMeImageAttachment
  | GroupMeLocationAttachment
  | GroupMeMentionsAttachment
  | GroupMeEmojiAttachment
  | GroupMeUnknownAttachment;

export type GroupMeCallbackData = {
  id: string;
  text: string;
  name: string;
  senderType: string;
  senderId: string;
  userId: string;
  groupId: string;
  sourceGuid: string;
  createdAt: number;
  system: boolean;
  avatarUrl: string | null;
  attachments: GroupMeAttachment[];
};

export type GroupMeProbe = {
  ok: boolean;
  botId?: string;
  error?: string;
};

export type CallbackAuthResult =
  | { ok: true; tokenId: "active" }
  | {
      ok: false;
      reason: "missing" | "mismatch" | "disabled";
    };

export type GroupMeApiGroup = {
  id: string;
  name: string;
  description: string;
  image_url: string | null;
  creator_user_id: string;
  created_at: number;
  updated_at: number;
  messages: {
    count: number;
    last_message_created_at: number;
    preview: {
      nickname: string;
      text: string;
    };
  };
};

export type GroupMeApiBot = {
  bot_id: string;
  group_id: string;
  name: string;
  avatar_url: string | null;
  callback_url: string;
  dm_notification: boolean;
  active: boolean;
};

export type ReplayCheck =
  | { kind: "accepted"; key: string }
  | { kind: "duplicate"; key: string };

export type WebhookDecision =
  | { kind: "accept"; message: GroupMeCallbackData; release: () => void }
  | {
      kind: "reject";
      status: number;
      reason: string;
      logLevel: "debug" | "warn";
    };
