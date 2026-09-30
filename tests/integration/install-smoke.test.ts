import { existsSync, writeFileSync } from "node:fs";
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

  it("imports the installed runtime entry, setup entry, and secret contract", () => {
    const script = `
      import assert from "node:assert/strict";
      import entry from "openclaw-groupme/dist/index.js";
      import setupEntry from "openclaw-groupme/dist/setup-entry.js";
      import { channelSecrets } from "openclaw-groupme/dist/secret-contract-api.js";

      assert.equal(entry.id, "groupme");
      assert.equal(entry.name, "GroupMe");
      assert.equal(typeof entry.register, "function");
      assert.equal(typeof entry.setChannelRuntime, "function");
      assert.equal(entry.kind, undefined);

      const plugin = entry.channelPlugin;
      assert.equal(plugin.id, "groupme");
      assert.equal(typeof plugin.gateway.startAccount, "function");
      assert.equal(typeof plugin.message.send.text, "function");
      assert.equal(typeof plugin.setupWizard.configure, "function");
      assert.equal(plugin.setupContract.kind, "channel-owned");

      assert.deepEqual(Object.keys(setupEntry), ["plugin"]);
      assert.equal(setupEntry.plugin.id, "groupme");
      assert.equal(setupEntry.plugin.setupContract, plugin.setupContract);
      assert.equal(setupEntry.plugin.gateway, undefined);

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

  it("installs the plugin manifest without the removed sidecar entrypoints", () => {
    const installed = join(tempProject, "node_modules", "openclaw-groupme");

    expect(existsSync(join(installed, "openclaw.plugin.json"))).toBe(true);
    for (const removed of [
      "dist/channel-plugin-api.js",
      "dist/runtime-setter-api.js",
      "dist/setup-plugin-api.js",
      "dist/src/policy.js",
    ]) {
      expect(existsSync(join(installed, removed)), removed).toBe(false);
    }
  });
});
