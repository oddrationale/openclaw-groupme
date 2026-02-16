import { afterEach, describe, expect, it, vi } from "vitest";
import { createBot, fetchGroups } from "../src/groupme-api.js";

function makeGroup(id: string, name: string) {
  return {
    id,
    name,
    description: "",
    image_url: null,
    creator_user_id: "user-1",
    created_at: 1,
    updated_at: 1,
    messages: {
      count: 0,
      last_message_created_at: 0,
      preview: {
        nickname: "",
        text: "",
      },
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchGroups", () => {
  it("paginates until the API returns an empty page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ response: [makeGroup("g1", "Family")] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ response: [makeGroup("g2", "Work")] }),
      )
      .mockResolvedValueOnce(jsonResponse({ response: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const groups = await fetchGroups("token-1");

    expect(groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the groups endpoint fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ meta: {} }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGroups("bad-token")).rejects.toThrow(/401/);
  });
});

describe("createBot", () => {
  it("creates and returns a bot", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        response: {
          bot: {
            bot_id: "bot-1",
            group_id: "group-1",
            name: "openclaw",
            avatar_url: null,
            callback_url: "https://placeholder.example.com/groupme/abc?k=secret",
            dm_notification: false,
            active: true,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const bot = await createBot({
      accessToken: "token-1",
      name: "openclaw",
      groupId: "group-1",
      callbackUrl: "https://placeholder.example.com/groupme/abc?k=secret",
    });

    expect(bot.bot_id).toBe("bot-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBeTypeOf("string");
    expect(JSON.parse(init.body as string)).toMatchObject({
      bot: {
        name: "openclaw",
        group_id: "group-1",
      },
    });
  });

  it("throws when bot creation fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ meta: {} }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createBot({
        accessToken: "bad-token",
        name: "openclaw",
        groupId: "group-1",
        callbackUrl: "https://placeholder.example.com/groupme/abc?k=secret",
      }),
    ).rejects.toThrow(/401/);
  });
});
