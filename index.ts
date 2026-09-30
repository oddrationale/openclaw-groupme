import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { groupmePlugin } from "./src/channel.js";
import { setGroupMeRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "groupme",
  name: "GroupMe",
  description: "GroupMe channel plugin",
  plugin: groupmePlugin,
  setRuntime: setGroupMeRuntime,
});
