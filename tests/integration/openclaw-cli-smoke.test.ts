import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTempProject,
  packTarball,
  removeTempProject,
  repoRoot,
  run,
} from "./helpers/package.js";

function isolatedOpenClawEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: home,
    NO_COLOR: "1",
    OPENCLAW_DISABLE_BONJOUR: "1",
    VITEST: "",
    VITEST_WORKER_ID: "",
  };
}

describe("OpenClaw CLI plugin smoke", () => {
  it("installs the packed plugin and inspects it through OpenClaw v2026.6.1", () => {
    const tempHome = createTempProject("openclaw-groupme-cli-");
    try {
      const tarball = packTarball(tempHome);
      const openclawCli = join(repoRoot, "node_modules", "openclaw", "openclaw.mjs");
      const env = isolatedOpenClawEnv(tempHome);

      run(process.execPath, [openclawCli, "plugins", "install", tarball, "--force"], { env });
      const inspectOutput = run(
        process.execPath,
        [openclawCli, "plugins", "inspect", "groupme", "--json", "--runtime"],
        { env },
      );
      const inspected = JSON.parse(inspectOutput) as {
        plugin?: {
          id?: string;
          packageName?: string;
          status?: string;
          channelIds?: string[];
          configSchema?: boolean;
          source?: string;
          dependencyStatus?: {
            requiredInstalled?: boolean;
          };
        };
        shape?: string;
        capabilities?: Array<{ kind?: string; ids?: string[] }>;
        diagnostics?: unknown[];
      };

      expect(inspected.plugin).toEqual(
        expect.objectContaining({
          id: "groupme",
          packageName: "openclaw-groupme",
          status: "loaded",
          channelIds: ["groupme"],
          configSchema: true,
        }),
      );
      expect(inspected.plugin?.source).toContain(".openclaw");
      expect(inspected.plugin?.dependencyStatus?.requiredInstalled).toBe(true);
      expect(inspected.shape).toBe("plain-capability");
      expect(inspected.capabilities).toContainEqual({ kind: "channel", ids: ["groupme"] });
      expect(
        inspected.diagnostics?.filter((entry) => (entry as { level?: string }).level === "error"),
      ).toEqual([]);
    } finally {
      removeTempProject(tempHome);
    }
  }, 120_000);
});
