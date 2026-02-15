import {
  BlockStreamingCoalesceSchema,
  MarkdownConfigSchema,
} from "openclaw/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

export const GroupMeAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    botId: z.string().optional(),
    accessToken: z.string().optional(),
    botName: z.string().optional(),
    callbackPath: z.string().optional(),
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
  })
  .strict();

export const GroupMeConfigSchema = GroupMeAccountSchemaBase.extend({
  accounts: z
    .record(z.string(), GroupMeAccountSchemaBase.optional())
    .optional(),
  defaultAccount: z.string().optional(),
}).strict();
