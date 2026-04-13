import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ResolvedGroupMeAccount } from "./types.js";
import { CHANNEL_ID, groupmeChannelPluginCommon } from "./channel-shared.js";

export const groupmeSetupPlugin: ChannelPlugin<ResolvedGroupMeAccount> = {
  id: CHANNEL_ID,
  ...groupmeChannelPluginCommon,
};
