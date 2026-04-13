import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { groupmePlugin } from "./api.js";
import { setGroupMeRuntime } from "./runtime-api.js";

export default defineChannelPluginEntry({
  id: "groupme",
  name: "GroupMe",
  description: "GroupMe channel plugin",
  plugin: groupmePlugin,
  setRuntime: setGroupMeRuntime,
});
