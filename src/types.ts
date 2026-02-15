import type {
  BlockStreamingCoalesceConfig,
  MarkdownConfig,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

export type GroupMeAllowFromEntry = string | number;

export type GroupMeAccountConfig = {
  name?: string;
  enabled?: boolean;
  botId?: string;
  accessToken?: string;
  botName?: string;
  callbackPath?: string;
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
