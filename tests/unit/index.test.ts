import type { OpenClawPluginApi } from "openclaw/plugin-sdk/channel-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../../index.js";
import { groupmePlugin } from "../../src/channel.js";
import { setGroupMeRuntime, tryGetGroupMeRuntime } from "../../src/runtime.js";

type RegistrationMode = OpenClawPluginApi["registrationMode"];

function fakeApi(registrationMode: RegistrationMode) {
  const runtime = { marker: registrationMode } as unknown as OpenClawPluginApi["runtime"];
  const registerChannel = vi.fn();
  const api = { registrationMode, runtime, registerChannel } as unknown as OpenClawPluginApi;
  return { api, runtime, registerChannel };
}

afterEach(() => {
  setGroupMeRuntime(undefined as unknown as Parameters<typeof setGroupMeRuntime>[0]);
});

describe("GroupMe channel plugin entry", () => {
  it("defines the channel plugin entry", () => {
    expect(plugin).toEqual(
      expect.objectContaining({
        id: "groupme",
        name: "GroupMe",
        description: "GroupMe channel plugin",
      }),
    );
    expect(plugin.channelPlugin).toBe(groupmePlugin);
    expect(plugin.register).toBeTypeOf("function");
    expect(plugin.setChannelRuntime).toBeTypeOf("function");
    expect(plugin.configSchema).toBeTypeOf("object");
  });

  it("registers the channel and captures the runtime on full registration", () => {
    const { api, runtime, registerChannel } = fakeApi("full");

    plugin.register(api);

    expect(registerChannel).toHaveBeenCalledWith({ plugin: groupmePlugin });
    expect(tryGetGroupMeRuntime()).toBe(runtime);
  });

  it("does not register the channel or runtime while collecting CLI metadata", () => {
    const { api, registerChannel } = fakeApi("cli-metadata");

    plugin.register(api);

    expect(registerChannel).not.toHaveBeenCalled();
    expect(tryGetGroupMeRuntime()).toBeNull();
  });

  it("exposes setChannelRuntime for hosts that inject the runtime directly", () => {
    const runtime = { direct: true } as unknown as Parameters<typeof setGroupMeRuntime>[0];

    plugin.setChannelRuntime?.(runtime);

    expect(tryGetGroupMeRuntime()).toBe(runtime);
  });
});
