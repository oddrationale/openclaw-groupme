import {
  BlockStreamingCoalesceSchema,
  MarkdownConfigSchema,
} from "openclaw/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

const GroupMeReplaySchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    ttlSeconds: z.number().int().positive().optional(),
    maxEntries: z.number().int().positive().optional(),
  })
  .strict();

const GroupMeRateLimitSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    windowMs: z.number().int().positive().optional(),
    maxRequestsPerIp: z.number().int().positive().optional(),
    maxRequestsPerSender: z.number().int().positive().optional(),
    maxConcurrent: z.number().int().positive().optional(),
  })
  .strict();

const GroupMeMediaSecuritySchema = z
  .object({
    allowPrivateNetworks: z.boolean().optional().default(false),
    maxDownloadBytes: z.number().int().positive().optional(),
    requestTimeoutMs: z.number().int().positive().optional(),
    allowedMimePrefixes: z.array(z.string()).optional(),
  })
  .strict();

const GroupMeLoggingSecuritySchema = z
  .object({
    redactSecrets: z.boolean().optional().default(true),
    logRejectedRequests: z.boolean().optional().default(true),
  })
  .strict();

const GroupMeCommandBypassSecuritySchema = z
  .object({
    requireAllowFrom: z.boolean().optional().default(true),
    requireMentionForCommands: z.boolean().optional().default(false),
  })
  .strict();

const GroupMeProxySecuritySchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    trustedProxyCidrs: z.array(z.string()).optional(),
    allowedPublicHosts: z.array(z.string()).optional(),
    requireHttpsProto: z.boolean().optional().default(false),
    rejectStatus: z
      .union([z.literal(400), z.literal(403), z.literal(404)])
      .optional(),
  })
  .strict();

const GroupMeSecuritySchema = z
  .object({
    replay: GroupMeReplaySchema.optional(),
    rateLimit: GroupMeRateLimitSchema.optional(),
    media: GroupMeMediaSecuritySchema.optional(),
    logging: GroupMeLoggingSecuritySchema.optional(),
    commandBypass: GroupMeCommandBypassSecuritySchema.optional(),
    proxy: GroupMeProxySecuritySchema.optional(),
  })
  .strict();

export const GroupMeAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    botId: z.string().optional(),
    accessToken: z.string().optional(),
    botName: z.string().optional(),
    groupId: z.string().optional(),
    callbackUrl: z.string().optional(),
    mentionPatterns: z.array(z.string()).optional(),
    requireMention: z.boolean().optional().default(true),
    historyLimit: z.number().int().nonnegative().optional(),
    allowFrom: z.array(allowFromEntry).optional(),
    markdown: MarkdownConfigSchema,
    textChunkLimit: z.number().int().positive().optional(),
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    responsePrefix: z.string().optional(),
    mediaMaxMb: z.number().positive().optional(),
    security: GroupMeSecuritySchema.optional(),
  })
  .strict();

export const GroupMeConfigSchema = GroupMeAccountSchemaBase.extend({
  accounts: z
    .record(z.string(), GroupMeAccountSchemaBase.optional())
    .optional(),
  defaultAccount: z.string().optional(),
}).strict();
