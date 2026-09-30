import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempProject } from "../integration/helpers/package.js";
import {
  callbackPayload,
  type FakeGroupMe,
  freePort,
  installPluginHome,
  type MockModel,
  newNonce,
  type OpenClawHome,
  PNG_BYTES,
  postCallback,
  type RunningGateway,
  startFakeGroupMe,
  startGateway,
  startMockModel,
  waitFor,
  writeGatewayConfig,
} from "./harness.js";

// Full pipeline against a real OpenClaw gateway: GroupMe webhook -> security
// pipeline -> channel ingress -> agent turn (stub model) -> durable reply
// delivery -> Bot API post (captured by a fake GroupMe API).
describe("GroupMe gateway end-to-end (hermetic)", () => {
  const groupId = "e2e-group-1";
  const callbackToken = randomBytes(12).toString("hex");
  let home: OpenClawHome;
  let model: MockModel;
  let groupme: FakeGroupMe;
  let gateway: RunningGateway;

  const postTexts = () => groupme.posts.map((post) => String(post.text ?? ""));

  beforeAll(async () => {
    groupme = await startFakeGroupMe();
    home = installPluginHome("openclaw-groupme-e2e-");
    // Agent-generated media lives in the workspace; the host authorizes the read
    // and hands the plugin a reader (no direct filesystem access in the plugin).
    const workspace = join(home.home, ".openclaw", "workspace");
    mkdirSync(workspace, { recursive: true });
    const imagePath = join(workspace, "groupme-e2e.png");
    writeFileSync(imagePath, PNG_BYTES);
    model = await startMockModel({ media: imagePath });
    const port = await freePort();
    writeGatewayConfig({
      home,
      gatewayPort: port,
      modelBaseUrl: model.baseUrl,
      groupme: {
        botId: "e2e-bot",
        accessToken: "e2e-access-token",
        callbackToken,
        groupId,
        botName: "OpenClawBot",
        requireMention: true,
        allowFrom: ["12345"],
      },
    });
    gateway = await startGateway({ home, port, fakeGroupMeBaseUrl: groupme.baseUrl });
  }, 240_000);

  afterAll(async () => {
    await gateway?.stop();
    await model?.close();
    await groupme?.close();
    if (home) {
      removeTempProject(home.home);
    }
  }, 60_000);

  it("rejects callbacks without the callback token", async () => {
    const response = await postCallback({
      port: gateway.port,
      callbackToken: "wrong-token",
      payload: callbackPayload({ group_id: groupId, text: "@OpenClawBot hi" }),
    });
    // Auth failures use the configured callbackRejectStatus (404 by default) so an
    // unauthenticated caller cannot tell the route exists.
    expect(response.status).toBe(404);
  });

  it("buffers unmentioned messages and replies with that context when mentioned", async () => {
    const background = newNonce("history");
    const buffered = await postCallback({
      port: gateway.port,
      callbackToken,
      payload: callbackPayload({ group_id: groupId, text: `just chatting ${background}` }),
    });
    expect(buffered.status).toBe(200);

    const nonce = newNonce("mention");
    const requestsBefore = model.requests.length;
    const mentioned = await postCallback({
      port: gateway.port,
      callbackToken,
      payload: callbackPayload({ group_id: groupId, text: `@OpenClawBot ping ${nonce}` }),
    });
    expect(mentioned.status).toBe(200);

    const reply = await waitFor(() => postTexts().find((text) => text.includes(nonce)), {
      timeoutMs: 90_000,
      description: `bot reply containing ${nonce}; posts=${JSON.stringify(groupme.posts)}\n${gateway.output()}`,
    });
    expect(reply).toBe(`pong ${nonce}`);
    expect(groupme.posts.find((post) => post.text === reply)?.bot_id).toBe("e2e-bot");

    // The unmentioned message never triggered a turn, but it reached the model
    // as buffered group history ("Chat history since last reply") on the
    // mentioned turn.
    expect(postTexts().some((text) => text.includes(background))).toBe(false);
    const turnRequest = JSON.stringify(model.requests.slice(requestsBefore));
    expect(turnRequest).toContain(background);
  }, 120_000);

  it("drops mentions from senders outside allowFrom and ignores bot messages", async () => {
    const outsider = newNonce("outsider");
    const fromBot = newNonce("bot");
    const control = newNonce("control");
    const postsBefore = groupme.posts.length;

    for (const payload of [
      callbackPayload({
        group_id: groupId,
        text: `@OpenClawBot ${outsider}`,
        sender_id: "99999",
        user_id: "99999",
      }),
      callbackPayload({
        group_id: groupId,
        text: `@OpenClawBot ${fromBot}`,
        sender_type: "bot",
      }),
    ]) {
      const response = await postCallback({ port: gateway.port, callbackToken, payload });
      expect(response.status).toBe(200);
    }

    // A follow-up mention from an allowed sender proves the gateway kept
    // processing; by the time it is answered the earlier events have settled.
    await postCallback({
      port: gateway.port,
      callbackToken,
      payload: callbackPayload({ group_id: groupId, text: `@OpenClawBot ${control}` }),
    });
    await waitFor(() => postTexts().find((text) => text.includes(control)), {
      timeoutMs: 90_000,
      description: `bot reply containing ${control}\n${gateway.output()}`,
    });

    const newPosts = postTexts().slice(postsBefore);
    expect(newPosts).toEqual([`pong ${control}`]);
  }, 120_000);

  it("uploads agent workspace media to the GroupMe image service and posts it with the reply", async () => {
    const nonce = newNonce("media");
    const uploadsBefore = groupme.uploads.length;
    const response = await postCallback({
      port: gateway.port,
      callbackToken,
      payload: callbackPayload({ group_id: groupId, text: `@OpenClawBot picture ${nonce}` }),
    });
    expect(response.status).toBe(200);

    const post = await waitFor(
      () => groupme.posts.find((candidate) => String(candidate.text ?? "").includes(nonce)),
      {
        timeoutMs: 90_000,
        description: `media reply containing ${nonce}; posts=${JSON.stringify(groupme.posts)}\n${gateway.output()}`,
      },
    );
    expect(post).toEqual({
      bot_id: "e2e-bot",
      text: `pong ${nonce}`,
      picture_url: "https://i.groupme.com/1x1.png.fake",
    });
    expect(groupme.uploads.slice(uploadsBefore)).toEqual([
      { contentType: "image/png", bytes: PNG_BYTES.length, accessToken: "e2e-access-token" },
    ]);
  }, 120_000);
});
