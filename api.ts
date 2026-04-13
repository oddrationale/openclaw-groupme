export type {
  ChannelPlugin,
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
} from "openclaw/plugin-sdk/core";
export type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
export type { ResolvedGroupMeAccount } from "./src/types.js";
export { groupmePlugin } from "./src/channel.js";
export { groupmeSetupPlugin } from "./src/channel.setup.js";
