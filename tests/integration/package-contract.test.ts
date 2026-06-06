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
      "dist/channel-plugin-api.js",
      "dist/runtime-setter-api.js",
      "dist/secret-contract-api.js",
      "dist/setup-plugin-api.js",
      "index.ts",
      "channel-plugin-api.ts",
      "runtime-setter-api.ts",
      "secret-contract-api.ts",
      "setup-entry.ts",
      "setup-plugin-api.ts",
      "src/channel.ts",
      "src/groupme-api.ts",
      "src/monitor.ts",
      "src/onboarding.ts",
      "src/secret-contract.ts",
      "src/send.ts",
    ];

    for (const file of expectedFiles) {
      expect(paths.has(file), `${file} should be included in npm pack`).toBe(true);
    }
  }, 60_000);

  it("keeps manifest paths and compatibility aligned with OpenClaw v2026.6.1", () => {
    const paths = packedPaths();
    const pkg = readRootPackageJson();
    const [extension] = pkg.openclaw.extensions;

    expect(extension).toBe("./dist/index.js");
    expect(pkg.openclaw.setupEntry).toBe("./dist/setup-entry.js");
    expect(paths.has(extension.replace(/^\.\//, ""))).toBe(true);
    expect(paths.has(pkg.openclaw.setupEntry.replace(/^\.\//, ""))).toBe(true);
    expect(pkg.openclaw.compat.pluginApi).toBe(">=2026.6.1");
    expect(pkg.peerDependencies.openclaw).toBe(">=2026.6.1");
    expect(pkg.engines.node).toBe(">=22.19.0");
  }, 60_000);

  it("packages every explicit sidecar entrypoint declared in package.json#files", () => {
    const paths = packedPaths();
    const pkg = readRootPackageJson();
    const sidecars = pkg.files.filter(
      (entry) => entry.endsWith("-api.ts") || entry === "setup-entry.ts",
    );

    expect(sidecars).toEqual([
      "channel-plugin-api.ts",
      "runtime-setter-api.ts",
      "secret-contract-api.ts",
      "setup-entry.ts",
      "setup-plugin-api.ts",
    ]);

    for (const sidecar of sidecars) {
      expect(paths.has(sidecar), `${sidecar} source should be packed`).toBe(true);
      expect(paths.has(`dist/${sidecar.replace(/\.ts$/, ".js")}`)).toBe(true);
    }
  }, 60_000);
});
