import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, type vi } from "vitest";
import { createBot, fetchGroups } from "../../src/groupme-api.js";
import { createGroupMeOnboardingAdapter } from "../../src/onboarding.js";
import { group, makePrompter, makeRuntime } from "../helpers/onboarding.js";
import { startTestHttpServer, type TestHttpServer } from "./helpers/http.js";

describe("GroupMe onboarding HTTP boundary", () => {
  let api: TestHttpServer | null = null;

  afterEach(async () => {
    await api?.close();
    api = null;
  });

  it("fetches groups, creates the selected bot, and saves split webhook settings", async () => {
    api = await startTestHttpServer((request, response) => {
      response.setHeader("content-type", "application/json");

      if (request.method === "GET" && request.path === "/groups") {
        expect(request.query.get("token")).toBe("access-token");
        expect(request.query.get("per_page")).toBe("100");
        expect(request.query.get("omit")).toBe("memberships");
        if (request.query.get("page") === "1") {
          response.end(JSON.stringify({ response: [group("g1", "Family"), group("g2", "Work")] }));
          return;
        }
        response.end(JSON.stringify({ response: [] }));
        return;
      }

      if (request.method === "POST" && request.path === "/bots") {
        expect(request.query.get("token")).toBe("access-token");
        const bot = (request.json as { bot?: Record<string, unknown> }).bot;
        expect(bot).toEqual(
          expect.objectContaining({
            name: "oddclaw",
            group_id: "g2",
            active: true,
          }),
        );
        expect(String(bot?.callback_url)).toMatch(
          /^https:\/\/bot\.example\.com\/groupme\/[0-9a-f]{16}\?k=[0-9a-f]{64}$/,
        );
        response.end(
          JSON.stringify({
            response: {
              bot: {
                bot_id: "bot-1234567890",
                group_id: "g2",
                name: "oddclaw",
                callback_url: bot?.callback_url,
                active: true,
              },
            },
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ meta: { errors: ["not found"] } }));
    });

    const adapter = createGroupMeOnboardingAdapter({
      fetchGroups: (accessToken) => fetchGroups(accessToken, { apiBaseUrl: api?.baseUrl }),
      createBot: (params) => createBot({ ...params, apiBaseUrl: api?.baseUrl }),
    });
    const { prompter, progressSpins } = makePrompter();
    (prompter.text as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("oddclaw")
      .mockResolvedValueOnce("access-token")
      .mockResolvedValueOnce("https://bot.example.com");
    (prompter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("g2");
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const result = await adapter.configure({
      cfg: { channels: {} } as OpenClawConfig,
      runtime: makeRuntime(),
      prompter,
      options: {},
      accountOverrides: { groupme: DEFAULT_ACCOUNT_ID },
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
    });

    const section = result.cfg.channels?.groupme as Record<string, unknown>;
    expect(result.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(section).toEqual(
      expect.objectContaining({
        botId: "bot-1234567890",
        accessToken: "access-token",
        botName: "oddclaw",
        groupId: "g2",
        publicDomain: "bot.example.com",
        requireMention: false,
      }),
    );
    expect(section.webhookPath).toEqual(expect.stringMatching(/^\/groupme\/[0-9a-f]{16}$/));
    expect(section.callbackToken).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(`${section.webhookPath as string}?k=${section.callbackToken as string}`).not.toBe(
      section.webhookPath,
    );
    expect(progressSpins.map((spin) => spin.stop.mock.calls[0]?.[0])).toEqual([
      "Found 2 groups",
      "Bot registered",
    ]);
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /groups",
      "GET /groups",
      "POST /bots",
    ]);
  });
});
