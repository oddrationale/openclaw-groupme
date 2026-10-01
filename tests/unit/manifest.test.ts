import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { describe, expect, it } from "vitest";
import { groupmeSetupPlugin } from "../../src/channel.setup.js";
import { GroupMeConfigSchema, groupmeConfigUiHints } from "../../src/config-schema.js";
import { groupmeSetupFields } from "../../src/setup-surface.js";

const repoRoot = join(import.meta.dirname, "../..");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
}

type PackageJson = {
  openclaw: {
    channel: Record<string, unknown> & {
      setup: { fields: Array<Record<string, unknown> & { key: string }> };
    };
  };
};

type PluginManifest = {
  id: string;
  channels: string[];
  activation?: Record<string, unknown>;
  channelConfigs: Record<string, { schema: unknown; uiHints: unknown }>;
};

// Cold-path metadata (package.json and openclaw.plugin.json) is read by OpenClaw
// without loading plugin code. These guards keep it in lockstep with the runtime
// definitions it mirrors.
describe("package.json#openclaw.channel", () => {
  const pkg = readJson("package.json") as PackageJson;

  it("mirrors groupmeSetupFields in declaration order", () => {
    const expected = Object.entries(groupmeSetupFields).map(([key, field]) =>
      Object.assign({ key }, field),
    );
    expect(pkg.openclaw.channel.setup.fields).toEqual(expected);
  });

  it("mirrors the runtime channel meta", () => {
    const { id, ...meta } = groupmeSetupPlugin.meta;
    expect(pkg.openclaw.channel).toEqual(expect.objectContaining({ id, ...meta }));
  });
});

describe("openclaw.plugin.json", () => {
  const manifest = readJson("openclaw.plugin.json") as PluginManifest;

  it("declares the groupme channel", () => {
    expect(manifest.id).toBe("groupme");
    expect(manifest.channels).toEqual(["groupme"]);
    expect(manifest.activation).toEqual({ onStartup: false });
  });

  it("keeps channelConfigs.groupme in sync with the zod schema and ui hints", () => {
    const { schema, uiHints } = buildChannelConfigSchema(GroupMeConfigSchema, {
      uiHints: groupmeConfigUiHints,
    });
    const committed = manifest.channelConfigs.groupme;

    expect(committed?.schema, "run `npm run manifest:sync`").toEqual(structuredClone(schema));
    expect(committed?.uiHints, "run `npm run manifest:sync`").toEqual(structuredClone(uiHints));
  });

  it("applies every account ui hint to named accounts too", () => {
    const keys = Object.keys(groupmeConfigUiHints);
    const topLevel = keys.filter((key) => !key.startsWith("accounts.*."));
    expect(topLevel).toEqual([
      "botId",
      "accessToken",
      "callbackToken",
      "groupId",
      "botName",
      "webhookPath",
      "security",
    ]);
    for (const key of topLevel) {
      expect(groupmeConfigUiHints[`accounts.*.${key}`]).toEqual(groupmeConfigUiHints[key]);
    }
    for (const key of ["botId", "accessToken", "callbackToken"]) {
      expect(groupmeConfigUiHints[key]?.sensitive, key).toBe(true);
    }
  });
});
