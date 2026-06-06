import { describe, expect, it } from "vitest";

const requiredSecrets = [
  "GROUPME_LIVE_ACCESS_TOKEN",
  "GROUPME_LIVE_BOT_ID",
  "GROUPME_LIVE_GROUP_ID",
] as const;

function readSecret(name: (typeof requiredSecrets)[number]): string {
  return process.env[name]?.trim() ?? "";
}

const hasLiveSecrets = requiredSecrets.every((name) => readSecret(name));
const describeLive = hasLiveSecrets ? describe : describe.skip;

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  return `${response.status} ${response.statusText}${text ? `: ${text}` : ""}`;
}

async function expectOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

async function expectStatus(response: Response, status: number): Promise<void> {
  if (response.status !== status) {
    throw new Error(await readError(response));
  }
}

describeLive("GroupMe API live smoke", () => {
  it("can read the configured group and post through the configured bot", async () => {
    const accessToken = readSecret("GROUPME_LIVE_ACCESS_TOKEN");
    const botId = readSecret("GROUPME_LIVE_BOT_ID");
    const groupId = readSecret("GROUPME_LIVE_GROUP_ID");

    const groupUrl = new URL(`https://api.groupme.com/v3/groups/${groupId}`);
    groupUrl.searchParams.set("token", accessToken);

    const groupResponse = await fetch(groupUrl);
    await expectOk(groupResponse);

    const groupPayload = (await groupResponse.json()) as { response?: { id?: unknown } };
    expect(String(groupPayload.response?.id ?? "")).toBe(groupId);

    const runId =
      process.env.GITHUB_RUN_ID?.trim() ||
      process.env.GITHUB_SHA?.slice(0, 12) ||
      `local-${Date.now()}`;
    const postResponse = await fetch("https://api.groupme.com/v3/bots/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bot_id: botId,
        text: `openclaw-groupme api live smoke ${runId}`,
      }),
    });

    await expectStatus(postResponse, 202);
  }, 30_000);
});
