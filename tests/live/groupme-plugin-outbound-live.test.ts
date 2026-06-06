import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTempProject,
  packTarball,
  removeTempProject,
  repoRoot,
  run,
} from "../integration/helpers/package.js";

const requiredSecrets = [
  "GROUPME_LIVE_ACCESS_TOKEN",
  "GROUPME_LIVE_BOT_ID",
  "GROUPME_LIVE_GROUP_ID",
] as const;

function readSecret(name: (typeof requiredSecrets)[number]): string {
  return process.env[name]?.trim() ?? "";
}

function isolatedOpenClawEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: home,
    NO_COLOR: "1",
    OPENCLAW_DISABLE_BONJOUR: "1",
    GROUPME_LIVE_ACCESS_TOKEN: readSecret("GROUPME_LIVE_ACCESS_TOKEN"),
    GROUPME_LIVE_BOT_ID: readSecret("GROUPME_LIVE_BOT_ID"),
    GROUPME_LIVE_GROUP_ID: readSecret("GROUPME_LIVE_GROUP_ID"),
    VITEST: "",
    VITEST_WORKER_ID: "",
  };
}

const hasLiveSecrets = requiredSecrets.every((name) => readSecret(name));
const describeLive = hasLiveSecrets ? describe : describe.skip;

describeLive("GroupMe plugin outbound live smoke", () => {
  it("sends through an installed OpenClaw channel plugin using env SecretRefs", () => {
    const tempHome = createTempProject("openclaw-groupme-plugin-live-");
    try {
      const tarball = packTarball(tempHome);
      const openclawCli = join(repoRoot, "node_modules", "openclaw", "openclaw.mjs");
      const env = isolatedOpenClawEnv(tempHome);
      const groupId = readSecret("GROUPME_LIVE_GROUP_ID");
      const runId =
        process.env.GITHUB_RUN_ID?.trim() ||
        process.env.GITHUB_SHA?.slice(0, 12) ||
        `local-${Date.now()}`;

      run(process.execPath, [openclawCli, "plugins", "install", tarball, "--force"], { env });
      run(
        process.execPath,
        [
          openclawCli,
          "channels",
          "add",
          "--channel",
          "groupme",
          "--token",
          "placeholder",
          "--account",
          "default",
          "--name",
          "Live Smoke",
        ],
        { env },
      );
      run(
        process.execPath,
        [
          openclawCli,
          "config",
          "set",
          "channels.groupme.botId",
          "--ref-source",
          "env",
          "--ref-provider",
          "default",
          "--ref-id",
          "GROUPME_LIVE_BOT_ID",
        ],
        { env },
      );
      run(
        process.execPath,
        [
          openclawCli,
          "config",
          "set",
          "channels.groupme.accessToken",
          "--ref-source",
          "env",
          "--ref-provider",
          "default",
          "--ref-id",
          "GROUPME_LIVE_ACCESS_TOKEN",
        ],
        { env },
      );
      run(
        process.execPath,
        [
          openclawCli,
          "config",
          "set",
          "channels.groupme.groupId",
          JSON.stringify(groupId),
          "--strict-json",
        ],
        { env },
      );

      const configOutput = run(
        process.execPath,
        [openclawCli, "config", "get", "channels.groupme", "--json"],
        { env },
      );
      const config = JSON.parse(configOutput) as {
        botId?: unknown;
        accessToken?: unknown;
        groupId?: unknown;
      };
      expect(config.botId).toEqual({
        source: "env",
        provider: "default",
        id: "GROUPME_LIVE_BOT_ID",
      });
      expect(config.accessToken).toEqual({
        source: "env",
        provider: "default",
        id: "GROUPME_LIVE_ACCESS_TOKEN",
      });
      expect(config.groupId).toBe(groupId);

      const sendOutput = run(
        process.execPath,
        [
          openclawCli,
          "message",
          "send",
          "--channel",
          "groupme",
          "--target",
          groupId,
          "--message",
          `openclaw-groupme plugin outbound live smoke ${runId}`,
          "--json",
        ],
        { env },
      );
      const send = JSON.parse(sendOutput) as {
        action?: string;
        channel?: string;
        dryRun?: boolean;
        messageId?: string;
      };
      expect(send).toEqual(
        expect.objectContaining({
          action: "send",
          channel: "groupme",
          dryRun: false,
        }),
      );
      expect(send.messageId).toEqual(expect.any(String));
    } finally {
      removeTempProject(tempHome);
    }
  }, 120_000);
});
