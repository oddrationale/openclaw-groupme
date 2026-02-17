import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { groupmePlugin } from "./src/channel.js";
import { setGroupMeRuntime } from "./src/runtime.js";

const plugin = {
  id: "groupme",
  name: "GroupMe",
  description: "GroupMe channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setGroupMeRuntime(api.runtime);
    api.registerChannel({ plugin: groupmePlugin as ChannelPlugin });
  },
};

export default plugin;
