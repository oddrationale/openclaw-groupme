import { describe, expect, it } from "vitest";
import plugin from "../index.js";

describe("GroupMe bundled channel entry", () => {
  it("defines the bundled channel entry", () => {
    expect(plugin).toEqual(
      expect.objectContaining({
        kind: "bundled-channel-entry",
        id: "groupme",
        name: "GroupMe",
        description: "GroupMe channel plugin",
      }),
    );
    expect(plugin.loadChannelPlugin).toBeTypeOf("function");
    expect(plugin.loadChannelSecrets).toBeTypeOf("function");
    expect(plugin.setChannelRuntime).toBeTypeOf("function");
  });
});
