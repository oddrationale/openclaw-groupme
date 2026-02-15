import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setGroupMeRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getGroupMeRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("GroupMe runtime not initialized");
  }
  return runtime;
}
