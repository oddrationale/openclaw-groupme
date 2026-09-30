import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { groupmeSetupPlugin } from "./src/channel.setup.js";

// Loaded instead of the full entry while the channel is disabled or unconfigured,
// so it must not pull in the webhook monitor, inbound pipeline, or sender.
export default defineSetupPluginEntry(groupmeSetupPlugin);
