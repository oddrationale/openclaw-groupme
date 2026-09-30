import { describe, expect, it, vi } from "vitest";

// The setup entry is loaded for disabled or unconfigured installs, so it must stay
// cheap: importing any of the runtime-path modules below is a regression.
vi.mock("../../src/monitor.js", () => {
  throw new Error("setup entry must not load the webhook monitor");
});
vi.mock("../../src/inbound.js", () => {
  throw new Error("setup entry must not load the inbound pipeline");
});
vi.mock("../../src/send.js", () => {
  throw new Error("setup entry must not load the outbound sender");
});

import setupEntry from "../../setup-entry.js";
import { groupmeSetupPlugin } from "../../src/channel.setup.js";
import { groupmeSetupContract } from "../../src/setup-surface.js";

describe("GroupMe setup entry", () => {
  it("exposes the setup-safe plugin without runtime-only adapters", () => {
    expect(setupEntry).toEqual({ plugin: groupmeSetupPlugin });

    const plugin = setupEntry.plugin as Record<string, unknown>;
    expect(plugin.id).toBe("groupme");
    expect(plugin.setupContract).toBe(groupmeSetupContract);
    expect(plugin.setupWizard).toBeDefined();
    expect(plugin.secrets).toBeDefined();
    expect(plugin.config).toBeDefined();
    for (const runtimeOnly of ["gateway", "outbound", "message", "status", "groups"]) {
      expect(plugin[runtimeOnly], runtimeOnly).toBeUndefined();
    }
  });

  it("declares group-only media capabilities and config reload prefixes", () => {
    expect(groupmeSetupPlugin.capabilities).toEqual({
      chatTypes: ["group"],
      media: true,
      blockStreaming: true,
    });
    expect(groupmeSetupPlugin.reload).toEqual({ configPrefixes: ["channels.groupme"] });
    expect(groupmeSetupPlugin.meta).toEqual(
      expect.objectContaining({ id: "groupme", label: "GroupMe", aliases: ["gm"] }),
    );
  });
});
