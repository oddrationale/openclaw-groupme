import { readFileSync } from "node:fs";
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
    // Pin state to this home even when the test process sets OPENCLAW_STATE_DIR.
    OPENCLAW_STATE_DIR: join(home, ".openclaw"),
    NO_COLOR: "1",
    OPENCLAW_DISABLE_BONJOUR: "1",
    GROUPME_LIVE_ACCESS_TOKEN: readSecret("GROUPME_LIVE_ACCESS_TOKEN"),
    GROUPME_LIVE_BOT_ID: readSecret("GROUPME_LIVE_BOT_ID"),
    GROUPME_LIVE_GROUP_ID: readSecret("GROUPME_LIVE_GROUP_ID"),
    VITEST: "",
    VITEST_WORKER_ID: "",
  };
}

async function waitForGroupMessage(
  groupId: string,
  text: string,
): Promise<{ sender_type?: string; text?: string | null }> {
  const url = new URL(`https://api.groupme.com/v3/groups/${groupId}/messages`);
  url.searchParams.set("token", readSecret("GROUPME_LIVE_ACCESS_TOKEN"));
  url.searchParams.set("limit", "20");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(url);
    if (response.ok) {
      const body = (await response.json()) as {
        response: { messages: Array<{ sender_type?: string; text?: string | null }> };
      };
      const match = body.response.messages.find((message) => message.text === text);
      if (match) {
        return match;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`message not found in group ${groupId}: ${text}`);
}

const hasLiveSecrets = requiredSecrets.every((name) => readSecret(name));
const describeLive = hasLiveSecrets ? describe : describe.skip;

describeLive("GroupMe plugin outbound live smoke", () => {
  it("sends through an installed OpenClaw channel plugin using env SecretRefs", async () => {
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

      run(
        process.execPath,
        [openclawCli, "plugins", "install", tarball, "--force", "--accept-capabilities"],
        { env },
      );
      run(
        process.execPath,
        [
          openclawCli,
          "channels",
          "add",
          "--channel",
          "groupme",
          "--bot-id",
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

      // `config get` redacts SecretRef ids in OpenClaw 2026.9.x, so read the
      // file the CLI wrote to confirm the refs (not plaintext) were stored.
      const written = JSON.parse(
        readFileSync(join(tempHome, ".openclaw", "openclaw.json"), "utf8"),
      ) as { channels?: { groupme?: Record<string, unknown> } };
      const config = (written.channels?.groupme ?? {}) as {
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
      // The Bot API returns no message id; the plugin confirms it from the group
      // feed (accessToken is configured), so OpenClaw records a real identity.
      expect(send.messageId).toMatch(/^\d+$/);
      const text = `openclaw-groupme plugin outbound live smoke ${runId}`;
      const delivered = await waitForGroupMessage(groupId, text);
      expect(delivered.sender_type).toBe("bot");
    } finally {
      removeTempProject(tempHome);
    }
  }, 120_000);
});
