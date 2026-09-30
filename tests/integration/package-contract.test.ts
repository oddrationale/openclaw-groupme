import { describe, expect, it } from "vitest";
import { packDryRun, readRootPackageJson } from "./helpers/package.js";

function packedPaths(): Set<string> {
  return new Set(packDryRun().files.map((file) => file.path));
}

describe("npm package contract", () => {
  it("packs the files OpenClaw and ClawHub need to load the plugin", () => {
    const paths = packedPaths();
    const expectedFiles = [
      "openclaw.plugin.json",
      "dist/index.js",
      "dist/setup-entry.js",
      "dist/secret-contract-api.js",
      "dist/src/channel.js",
      "dist/src/channel.setup.js",
      "dist/src/setup-surface.js",
      "dist/src/webhook-path.js",
      "dist/src/config-schema.js",
      "index.ts",
      "secret-contract-api.ts",
      "setup-entry.ts",
      "src/channel.ts",
      "src/channel.setup.ts",
      "src/setup-surface.ts",
      "src/webhook-path.ts",
      "src/groupme-api.ts",
      "src/monitor.ts",
      "src/onboarding.ts",
      "src/secret-contract.ts",
      "src/send.ts",
      "LICENSE",
      "README.md",
    ];

    for (const file of expectedFiles) {
      expect(paths.has(file), `${file} should be included in npm pack`).toBe(true);
    }
  }, 60_000);

  it("does not pack removed sidecars, tests, or tooling", () => {
    const paths = [...packedPaths()];
    const removed = [
      "channel-plugin-api.ts",
      "runtime-setter-api.ts",
      "setup-plugin-api.ts",
      "dist/channel-plugin-api.js",
      "dist/runtime-setter-api.js",
      "dist/setup-plugin-api.js",
      "src/policy.ts",
      "dist/src/policy.js",
    ];

    for (const file of removed) {
      expect(paths, `${file} should not be packed`).not.toContain(file);
    }
    expect(paths.filter((path) => /^(tests|scripts|\.github)\//.test(path))).toEqual([]);
  }, 60_000);

  it("keeps manifest paths and compatibility aligned with OpenClaw 2026.9.7", () => {
    const paths = packedPaths();
    const pkg = readRootPackageJson();
    const [extension] = pkg.openclaw.extensions;

    expect(pkg.openclaw.extensions).toEqual(["./dist/index.js"]);
    expect(extension).toBe("./dist/index.js");
    expect(pkg.openclaw.setupEntry).toBe("./dist/setup-entry.js");
    expect(paths.has(extension.replace(/^\.\//, ""))).toBe(true);
    expect(paths.has(pkg.openclaw.setupEntry.replace(/^\.\//, ""))).toBe(true);
    expect(pkg.openclaw.compat.pluginApi).toBe(">=2026.9.7");
    expect(pkg.openclaw.build.openclawVersion).toBe("2026.9.7");
    expect(pkg.openclaw.install).toEqual({
      npmSpec: "openclaw-groupme",
      clawhubSpec: "clawhub:openclaw-groupme",
      defaultChoice: "npm",
      minHostVersion: ">=2026.9.7",
    });
    expect(pkg.openclaw.startup).toBeUndefined();
    expect(pkg.peerDependencies.openclaw).toBe(">=2026.9.7");
    expect(pkg.devDependencies.openclaw).toBe(pkg.openclaw.build.openclawVersion);
    expect(pkg.engines.node).toBe(">=24.16.0 <25 || >=26.1.0");
  }, 60_000);

  it("packages every explicit entrypoint declared in package.json#files", () => {
    const paths = packedPaths();
    const pkg = readRootPackageJson();
    const entrypoints = pkg.files.filter((entry) => /^[^/]+\.ts$/.test(entry));

    expect(entrypoints).toEqual(["index.ts", "secret-contract-api.ts", "setup-entry.ts"]);

    for (const entrypoint of entrypoints) {
      expect(paths.has(entrypoint), `${entrypoint} source should be packed`).toBe(true);
      expect(paths.has(`dist/${entrypoint.replace(/\.ts$/, ".js")}`)).toBe(true);
    }
  }, 60_000);
});
