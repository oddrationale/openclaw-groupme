import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { groupmeSetupPlugin } from "./src/channel.setup.js";

export default defineSetupPluginEntry(groupmeSetupPlugin);
