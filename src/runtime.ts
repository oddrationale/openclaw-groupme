import { createPluginRuntimeStore, type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const {
  setRuntime: setGroupMeRuntime,
  getRuntime: getGroupMeRuntime,
  tryGetRuntime: tryGetGroupMeRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "groupme",
  errorMessage: "GroupMe runtime not initialized - plugin not registered",
});

export { getGroupMeRuntime, setGroupMeRuntime, tryGetGroupMeRuntime };
