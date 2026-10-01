import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  freePort,
  installPluginHome,
  type MockModel,
  newNonce,
  type OpenClawHome,
  postCallback,
  type RunningGateway,
  startGateway,
  startMockModel,
  waitFor,
  writeGatewayConfig,
} from "../e2e/harness.js";
import { removeTempProject } from "../integration/helpers/package.js";

// Live end-to-end smoke: a real GroupMe group, bot, and Image Service with a real
// OpenClaw gateway. The user message is posted to GroupMe with the access token,
// and GroupMe's own message JSON is delivered to the gateway webhook exactly as a
// bot callback would deliver it (CI has no public ingress for GroupMe to reach).
// The agent model is a local stub, so no model credentials are needed.

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

const GROUPME_API = "https://api.groupme.com/v3";
// A public https image the agent "generates" via a MEDIA: directive.
const LIVE_IMAGE_URL =
  "https://raw.githubusercontent.com/oddrationale/openclaw-groupme/main/docs/images/dev-groupme-bots.png";

type GroupMeMessage = {
  id: string;
  text: string | null;
  sender_type: string;
  attachments?: Array<{ type?: string; url?: string }>;
};

async function groupmeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(`${GROUPME_API}${path}`);
  url.searchParams.set("token", readSecret("GROUPME_LIVE_ACCESS_TOKEN"));
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    throw new Error(`GroupMe ${init?.method ?? "GET"} ${path} failed: ${response.status}`);
  }
  return ((await response.json()) as { response: T }).response;
}

/** Posts as the access-token owner and returns GroupMe's message object. */
async function postUserMessage(groupId: string, text: string): Promise<Record<string, unknown>> {
  const result = await groupmeRequest<{ message: Record<string, unknown> }>(
    `/groups/${groupId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ message: { source_guid: randomUUID(), text } }),
    },
  );
  return result.message;
}

async function findBotMessage(groupId: string, text: string): Promise<GroupMeMessage | undefined> {
  const result = await groupmeRequest<{ messages: GroupMeMessage[] }>(
    `/groups/${groupId}/messages?limit=20`,
  );
  return result.messages.find(
    (message) => message.sender_type === "bot" && message.text?.trim() === text,
  );
}

describeLive("GroupMe gateway live end-to-end", () => {
  const groupId = readSecret("GROUPME_LIVE_GROUP_ID");
  const callbackToken = randomBytes(12).toString("hex");
  let home: OpenClawHome;
  let model: MockModel;
  let gateway: RunningGateway;

  beforeAll(async () => {
    model = await startMockModel({ media: LIVE_IMAGE_URL });
    home = installPluginHome("openclaw-groupme-live-e2e-", {
      GROUPME_LIVE_ACCESS_TOKEN: readSecret("GROUPME_LIVE_ACCESS_TOKEN"),
      GROUPME_LIVE_BOT_ID: readSecret("GROUPME_LIVE_BOT_ID"),
    });
    const port = await freePort();
    writeGatewayConfig({
      home,
      gatewayPort: port,
      modelBaseUrl: model.baseUrl,
      groupme: {
        // Credentials stay in the environment and resolve as SecretRefs.
        botId: { source: "env", provider: "default", id: "GROUPME_LIVE_BOT_ID" },
        accessToken: { source: "env", provider: "default", id: "GROUPME_LIVE_ACCESS_TOKEN" },
        callbackToken,
        groupId,
        requireMention: false,
      },
    });
    gateway = await startGateway({ home, port });
  }, 240_000);

  afterAll(async () => {
    await gateway?.stop();
    await model?.close();
    if (home) {
      removeTempProject(home.home);
    }
  }, 60_000);

  it("replies in the live group to a real GroupMe message", async () => {
    const nonce = newNonce("live");
    const message = await postUserMessage(groupId, `openclaw-groupme live e2e ${nonce}`);
    expect(message.sender_type).toBe("user");

    const response = await postCallback({ port: gateway.port, callbackToken, payload: message });
    expect(response.status).toBe(200);

    const reply = await waitFor(() => findBotMessage(groupId, `pong ${nonce}`), {
      timeoutMs: 90_000,
      intervalMs: 3_000,
      description: `bot reply "pong ${nonce}" in group ${groupId}\n${gateway.output()}`,
    });
    expect(reply.sender_type).toBe("bot");
  }, 150_000);

  it("uploads agent media through the GroupMe Image Service", async () => {
    const nonce = newNonce("media");
    const message = await postUserMessage(groupId, `openclaw-groupme live e2e picture ${nonce}`);

    const response = await postCallback({ port: gateway.port, callbackToken, payload: message });
    expect(response.status).toBe(200);

    const reply = await waitFor(() => findBotMessage(groupId, `pong ${nonce}`), {
      timeoutMs: 120_000,
      intervalMs: 3_000,
      description: `bot media reply "pong ${nonce}" in group ${groupId}\n${gateway.output()}`,
    });
    const image = reply.attachments?.find((attachment) => attachment.type === "image");
    expect(image?.url).toMatch(/^https:\/\/i\.groupme\.com\//);
  }, 180_000);
});
