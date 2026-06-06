import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

const plugin = defineBundledChannelEntry({
  id: "groupme",
  name: "GroupMe",
  description: "GroupMe channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "groupmePlugin",
  },
  secrets: {
    specifier: "./secret-contract-api.js",
    exportName: "channelSecrets",
  },
  runtime: {
    specifier: "./runtime-setter-api.js",
    exportName: "setGroupMeRuntime",
  },
});

export default plugin;
