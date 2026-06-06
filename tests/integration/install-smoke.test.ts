import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTempProject,
  packTarball,
  removeTempProject,
  repoRoot,
  run,
  runNpm,
} from "./helpers/package.js";

describe("installed package smoke test", () => {
  let tempProject: string;

  beforeAll(() => {
    tempProject = createTempProject("openclaw-groupme-install-");
    const tarball = packTarball(tempProject);
    const openclawPath = resolve(repoRoot, "node_modules/openclaw");

    writeFileSync(
      join(tempProject, "package.json"),
      JSON.stringify({ private: true, type: "module" }, null, 2),
    );

    runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball, openclawPath], {
      cwd: tempProject,
    });
  }, 120_000);

  afterAll(() => {
    removeTempProject(tempProject);
  });

  it("imports the installed runtime, setup, channel, and secret sidecars", () => {
    const script = `
      import assert from "node:assert/strict";
      import entry from "openclaw-groupme/dist/index.js";
      import setupEntry from "openclaw-groupme/dist/setup-entry.js";
      import { groupmePlugin } from "openclaw-groupme/dist/channel-plugin-api.js";
      import { channelSecrets } from "openclaw-groupme/dist/secret-contract-api.js";

      assert.equal(entry.kind, "bundled-channel-entry");
      assert.equal(entry.id, "groupme");
      assert.equal(typeof entry.loadChannelPlugin, "function");
      assert.equal(typeof entry.loadChannelSecrets, "function");
      assert.equal(typeof entry.setChannelRuntime, "function");

      assert.equal(setupEntry.kind, "bundled-channel-setup-entry");
      assert.equal(groupmePlugin.id, "groupme");
      assert.equal(typeof groupmePlugin.gateway.startAccount, "function");
      assert.equal(typeof groupmePlugin.setupWizard.configure, "function");

      const ids = channelSecrets.secretTargetRegistryEntries.map((entry) => entry.id).sort();
      assert.deepEqual(ids, [
        "channels.groupme.accessToken",
        "channels.groupme.accounts.*.accessToken",
        "channels.groupme.accounts.*.botId",
        "channels.groupme.accounts.*.callbackToken",
        "channels.groupme.botId",
        "channels.groupme.callbackToken",
      ]);
    `;

    expect(() =>
      run("node", ["--input-type=module", "--eval", script], { cwd: tempProject }),
    ).not.toThrow();
  });
});
