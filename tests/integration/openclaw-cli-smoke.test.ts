import { readFileSync } from "node:fs";
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
    // The vitest setup file points OPENCLAW_STATE_DIR at a temp dir for in-process
    // tests; clear it so the CLI derives its state dir from the isolated HOME.
    OPENCLAW_STATE_DIR: "",
    VITEST: "",
    VITEST_WORKER_ID: "",
  };
}

function readGroupMeConfig(home: string): Record<string, unknown> & {
  accounts?: Record<string, Record<string, unknown>>;
} {
  const config = JSON.parse(readFileSync(join(home, ".openclaw", "openclaw.json"), "utf8")) as {
    channels?: { groupme?: Record<string, unknown> };
  };
  return config.channels?.groupme ?? {};
}

describe("OpenClaw CLI plugin smoke", () => {
  it("installs, configures, inspects, and dry-runs the channel through OpenClaw 2026.9.7", () => {
    const tempHome = createTempProject("openclaw-groupme-cli-");
    try {
      const tarball = packTarball(tempHome);
      const openclawCli = join(repoRoot, "node_modules", "openclaw", "openclaw.mjs");
      const env = isolatedOpenClawEnv(tempHome);

      // Third-party archives need explicit capability consent since 2026.9.7.
      run(
        process.execPath,
        [openclawCli, "plugins", "install", tarball, "--force", "--accept-capabilities"],
        { env },
      );
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

      const allChannelsOutput = run(
        process.execPath,
        [openclawCli, "channels", "list", "--all", "--json"],
        {
          env,
        },
      );
      const allChannels = JSON.parse(allChannelsOutput) as {
        chat?: Record<string, { installed?: boolean; origin?: string }>;
      };
      expect(allChannels.chat?.groupme).toEqual(
        expect.objectContaining({
          installed: true,
          origin: "available",
        }),
      );

      const addHelp = run(
        process.execPath,
        [openclawCli, "channels", "add", "--channel", "groupme", "--help"],
        { env },
      );
      for (const flag of [
        "--bot-id <id>",
        "--token <bot-id>",
        "--access-token <token>",
        "--callback-token <token>",
        "--group-id <id>",
        "--bot-name <name>",
        "--webhook-path <path>",
        "--webhook-url <url>",
      ]) {
        expect(addHelp, flag).toContain(flag);
      }

      // --token is kept as an alias for --bot-id.
      run(
        process.execPath,
        [
          openclawCli,
          "channels",
          "add",
          "--channel",
          "groupme",
          "--token",
          "fake-bot",
          "--account",
          "default",
          "--name",
          "Probe",
        ],
        { env },
      );

      const groupmeConfigOutput = run(
        process.execPath,
        [openclawCli, "config", "get", "channels.groupme", "--json"],
        { env },
      );
      const groupmeConfig = JSON.parse(groupmeConfigOutput) as {
        enabled?: boolean;
        name?: string;
        botId?: string;
      };
      // Sensitive setup fields are redacted by `config get`; the stored value is intact.
      expect(groupmeConfig).toEqual(
        expect.objectContaining({
          enabled: true,
          name: "Probe",
          botId: "__OPENCLAW_REDACTED__",
        }),
      );
      expect(readGroupMeConfig(tempHome)).toEqual(
        expect.objectContaining({ enabled: true, name: "Probe", botId: "fake-bot" }),
      );

      const configuredChannelsOutput = run(
        process.execPath,
        [openclawCli, "channels", "list", "--json"],
        { env },
      );
      const configuredChannels = JSON.parse(configuredChannelsOutput) as {
        chat?: Record<string, { accounts?: string[]; installed?: boolean; origin?: string }>;
      };
      expect(configuredChannels.chat?.groupme).toEqual(
        expect.objectContaining({
          accounts: ["default"],
          installed: true,
          origin: "configured",
        }),
      );

      const statusOutput = run(
        process.execPath,
        [openclawCli, "channels", "status", "--channel", "groupme", "--json"],
        { env },
      );
      const status = JSON.parse(statusOutput) as {
        configOnly?: boolean;
        configuredChannels?: string[];
      };
      expect(status.configOnly).toBe(true);
      expect(status.configuredChannels).toContain("groupme");

      run(
        process.execPath,
        [
          openclawCli,
          "channels",
          "add",
          "--channel",
          "groupme",
          "--account",
          "work",
          "--bot-id",
          "work-bot",
          "--group-id",
          "42",
          "--webhook-url",
          "https://bot.example.com/gm/work?k=cb-secret",
        ],
        { env },
      );
      expect(readGroupMeConfig(tempHome).accounts?.work).toEqual(
        expect.objectContaining({
          enabled: true,
          botId: "work-bot",
          groupId: "42",
          webhookPath: "/gm/work",
          callbackToken: "cb-secret",
        }),
      );

      const dryRunOutput = run(
        process.execPath,
        [
          openclawCli,
          "message",
          "send",
          "--channel",
          "groupme",
          "--target",
          "123",
          "--message",
          "probe",
          "--dry-run",
          "--json",
        ],
        { env },
      );
      const dryRun = JSON.parse(dryRunOutput) as {
        action?: string;
        channel?: string;
        dryRun?: boolean;
        payload?: {
          to?: string;
        };
      };
      expect(dryRun).toEqual(
        expect.objectContaining({
          action: "send",
          channel: "groupme",
          dryRun: true,
        }),
      );
      expect(dryRun.payload?.to).toBe("123");
    } finally {
      removeTempProject(tempHome);
    }
  }, 120_000);
});
