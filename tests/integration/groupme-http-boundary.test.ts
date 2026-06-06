import { afterEach, describe, expect, it } from "vitest";
import { createBot, fetchGroups } from "../../src/groupme-api.js";
import { sendGroupMeMessage, uploadGroupMeImage } from "../../src/send.js";
import { startTestHttpServer, type TestHttpServer } from "./helpers/http.js";

describe("GroupMe HTTP boundary", () => {
  const servers: TestHttpServer[] = [];

  async function server(
    handler: Parameters<typeof startTestHttpServer>[0],
  ): Promise<TestHttpServer> {
    const next = await startTestHttpServer(handler);
    servers.push(next);
    return next;
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((next) => next.close()));
  });

  it("fetches groups with token, pagination, and omitted memberships", async () => {
    const api = await server((request, response) => {
      expect(request.path).toBe("/groups");
      expect(request.query.get("token")).toBe("access-token");
      expect(request.query.get("per_page")).toBe("100");
      expect(request.query.get("omit")).toBe("memberships");

      response.setHeader("content-type", "application/json");
      if (request.query.get("page") === "1") {
        response.end(JSON.stringify({ response: [{ id: "g1", name: "One" }] }));
        return;
      }
      response.end(JSON.stringify({ response: [] }));
    });

    await expect(fetchGroups("access-token", { apiBaseUrl: api.baseUrl })).resolves.toEqual([
      expect.objectContaining({ id: "g1", name: "One" }),
    ]);
    expect(api.requests.map((request) => request.query.get("page"))).toEqual(["1", "2"]);
  });

  it("creates a bot with the expected request shape", async () => {
    const api = await server((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.path).toBe("/bots");
      expect(request.query.get("token")).toBe("access-token");
      expect(request.headers["content-type"]).toContain("application/json");
      expect(request.json).toEqual({
        bot: {
          name: "OpenClaw",
          group_id: "group-1",
          callback_url: "https://example.test/groupme?k=token",
          active: true,
        },
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ response: { bot: { bot_id: "bot-1" } } }));
    });

    await expect(
      createBot({
        accessToken: "access-token",
        name: "OpenClaw",
        groupId: "group-1",
        callbackUrl: "https://example.test/groupme?k=token",
        apiBaseUrl: api.baseUrl,
      }),
    ).resolves.toEqual(expect.objectContaining({ bot_id: "bot-1" }));
  });

  it("posts outbound text to the Bot API", async () => {
    const api = await server((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.path).toBe("/bots/post");
      expect(request.headers["content-type"]).toContain("application/json");
      expect(request.json).toEqual({
        bot_id: "bot-1",
        text: "hello from integration",
      });
      response.statusCode = 202;
      response.end("{}");
    });

    const result = await sendGroupMeMessage({
      botId: "bot-1",
      text: "hello from integration",
      apiBaseUrl: api.baseUrl,
    });

    expect(result.messageId).toEqual(expect.any(String));
    expect(result.timestamp).toEqual(expect.any(Number));
  });

  it("uploads image bytes to the Image Service and extracts the picture URL", async () => {
    const image = await server((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.path).toBe("/pictures");
      expect(request.headers["x-access-token"]).toBe("access-token");
      expect(request.headers["content-type"]).toBe("image/png");
      expect(request.body).toBe("fake-image");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ payload: { picture_url: "https://i.groupme.test/pic" } }));
    });

    await expect(
      uploadGroupMeImage({
        accessToken: "access-token",
        imageData: Buffer.from("fake-image"),
        contentType: "image/png",
        imageBaseUrl: image.baseUrl,
      }),
    ).resolves.toBe("https://i.groupme.test/pic");
  });
});
