// Regenerates openclaw.plugin.json#channelConfigs.groupme.{schema,uiHints} from the
// runtime zod schema so cold-path config validation matches the loaded plugin.
// Usage: npm run build && node scripts/sync-manifest.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "openclaw.plugin.json");
const { GroupMeConfigSchema, groupmeConfigUiHints } = await import(
  join(root, "dist/src/config-schema.js")
);

const { schema, uiHints } = buildChannelConfigSchema(GroupMeConfigSchema, {
  uiHints: groupmeConfigUiHints,
});
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const current = manifest.channelConfigs?.groupme ?? {};
manifest.channelConfigs = {
  ...manifest.channelConfigs,
  groupme: { ...current, schema, uiHints },
};
const next = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes("--check")) {
  // Compare parsed JSON so whitespace in the committed file does not matter.
  const committed = JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (committed !== JSON.stringify(manifest)) {
    console.error("openclaw.plugin.json is out of date; run `npm run manifest:sync`.");
    process.exit(1);
  }
} else {
  writeFileSync(manifestPath, next);
}
