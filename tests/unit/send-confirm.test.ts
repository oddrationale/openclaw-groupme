import { describe, expect, it, vi } from "vitest";
import { confirmGroupMeBotMessageId, sendGroupMeMedia, sendGroupMeText } from "../../src/send.js";
import type { CoreConfig } from "../../src/types.js";

type Listed = {
  id?: unknown;
  text?: unknown;
  sender_type?: unknown;
  created_at?: unknown;
  attachments?: Array<{ type?: unknown; url?: unknown }>;
};

const SENT_AT = 1_790_000_000_000;
const NOW_SECONDS = SENT_AT / 1000;

function listing(messages: Listed[]): Response {
  return new Response(JSON.stringify({ response: { messages } }), { status: 200 });
}

function botMessage(overrides: Listed = {}): Listed {
  return {
    id: `id-${Math.random()}`,
    text: "hello",
    sender_type: "bot",
    created_at: NOW_SECONDS,
    attachments: [],
    ...overrides,
  };
}

describe("confirmGroupMeBotMessageId", () => {
  it("returns the matching bot post and queries the group feed with the access token", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      listing([
        botMessage({ id: "user-msg", sender_type: "user" }),
        botMessage({ id: "other-text", text: "different" }),
        botMessage({ id: "too-old", created_at: NOW_SECONDS - 60 }),
        botMessage({ id: 42 }),
        botMessage({ id: "match-1", text: "  hello  " }),
      ]),
    );

    const id = await confirmGroupMeBotMessageId({
      accessToken: "token-1",
      groupId: "g 1",
      text: "hello",
      sentAt: SENT_AT,
      fetchFn,
      delaysMs: [0],
    });

    expect(id).toBe("match-1");
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://api.groupme.com/v3/groups/g%201/messages");
    expect(url.searchParams.get("token")).toBe("token-1");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("does not attribute the same message to two sends", async () => {
    const messages = [
      botMessage({ id: "dup-2", text: "dup" }),
      botMessage({ id: "dup-1", text: "dup" }),
    ];
    const fetchFn = vi.fn(async () => listing(messages));
    const params = { accessToken: "t", groupId: "g1", text: "dup", sentAt: SENT_AT, fetchFn };

    expect(await confirmGroupMeBotMessageId({ ...params, delaysMs: [0] })).toBe("dup-2");
    expect(await confirmGroupMeBotMessageId({ ...params, delaysMs: [0] })).toBe("dup-1");
    expect(await confirmGroupMeBotMessageId({ ...params, delaysMs: [0] })).toBeUndefined();
  });

  it("keeps a bounded memory of attributed ids", async () => {
    const params = { accessToken: "t", groupId: "g1", text: "cap", sentAt: SENT_AT, delaysMs: [0] };
    for (let index = 0; index <= 500; index += 1) {
      const id = await confirmGroupMeBotMessageId({
        ...params,
        fetchFn: vi.fn(async () => listing([botMessage({ id: `cap-${index}`, text: "cap" })])),
      });
      expect(id).toBe(`cap-${index}`);
    }
    // The oldest attribution was evicted, so its id can be matched again.
    const reused = await confirmGroupMeBotMessageId({
      ...params,
      fetchFn: vi.fn(async () =>
        listing([
          botMessage({ id: "cap-1", text: "cap" }),
          botMessage({ id: "cap-0", text: "cap" }),
        ]),
      ),
    });
    expect(reused).toBe("cap-0");
  });

  it("requires the posted picture for media sends", async () => {
    const fetchFn = vi.fn(async () =>
      listing([
        botMessage({ id: "no-picture", text: "" }),
        botMessage({
          id: "other-picture",
          text: null,
          attachments: [{ type: "image", url: "https://i.groupme.com/other" }],
        }),
        botMessage({
          id: "with-picture",
          text: null,
          attachments: [
            { type: "emoji", url: "https://i.groupme.com/pic" },
            { type: "image", url: "https://i.groupme.com/pic" },
          ],
        }),
      ]),
    );

    const id = await confirmGroupMeBotMessageId({
      accessToken: "t",
      groupId: "g1",
      text: "",
      pictureUrl: "https://i.groupme.com/pic",
      sentAt: SENT_AT,
      fetchFn,
      delaysMs: [0],
    });
    expect(id).toBe("with-picture");
  });

  it("retries after failed or empty lookups and gives up without guessing", async () => {
    const fetchFn = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(listing([botMessage({ id: "late", text: "late" })]));

    const found = await confirmGroupMeBotMessageId({
      accessToken: "t",
      groupId: "g1",
      text: "late",
      sentAt: SENT_AT,
      fetchFn,
      delaysMs: [0, 0, 0, 0],
    });
    expect(found).toBe("late");
    expect(fetchFn).toHaveBeenCalledTimes(4);

    const missing = await confirmGroupMeBotMessageId({
      accessToken: "t",
      groupId: "g1",
      text: "never",
      sentAt: SENT_AT,
      fetchFn: vi.fn(async () => listing([])),
      delaysMs: [0, 0],
    });
    expect(missing).toBeUndefined();
  });

  it("stops once the send is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn(async () => listing([botMessage()]));

    const id = await confirmGroupMeBotMessageId({
      accessToken: "t",
      groupId: "g1",
      text: "hello",
      sentAt: SENT_AT,
      fetchFn,
      signal: controller.signal,
      delaysMs: [0],
    });
    expect(id).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses the default retry schedule when none is given", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => listing([botMessage({ id: "timed", text: "timed" })]));
      const pending = confirmGroupMeBotMessageId({
        accessToken: "t",
        groupId: "g1",
        text: "timed",
        sentAt: SENT_AT,
        fetchFn,
      });
      await vi.advanceTimersByTimeAsync(149);
      expect(fetchFn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe("timed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("send helpers with confirmMessageId", () => {
  function cfg(account: Record<string, unknown>): CoreConfig {
    return { channels: { groupme: { groupId: "cfg-group", ...account } } } as CoreConfig;
  }

  function routedFetch(messages: Listed[]) {
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bots/post")) {
        return new Response("", { status: 202 });
      }
      if (url.includes("/pictures")) {
        return new Response(
          JSON.stringify({ payload: { picture_url: "https://i.groupme.com/up" } }),
          {
            status: 200,
          },
        );
      }
      if (url.startsWith("https://example.com/")) {
        return new Response(Buffer.from([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return listing(messages.map((message) => ({ ...message, created_at: Date.now() / 1000 })));
    });
  }

  it("confirms text sends against the target group", async () => {
    const fetchFn = routedFetch([botMessage({ id: "text-id", text: "hi there" })]);
    const result = await sendGroupMeText({
      cfg: cfg({ botId: "bot-1", accessToken: "token-1" }),
      to: "groupme:group:g7",
      text: "hi there",
      fetchFn,
      confirmMessageId: true,
    });
    expect(result.messageId).toBe("text-id");
    const lookup = fetchFn.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/messages"));
    expect(lookup).toContain("/groups/g7/messages");
  });

  it("falls back to the configured group and confirms media sends by picture", async () => {
    const fetchFn = routedFetch([
      botMessage({
        id: "media-id",
        text: "look",
        attachments: [{ type: "image", url: "https://i.groupme.com/up" }],
      }),
    ]);
    const result = await sendGroupMeMedia({
      cfg: cfg({ botId: "bot-1", accessToken: "token-1" }),
      to: "   ",
      text: "look",
      mediaUrl: "https://example.com/pic.png",
      fetchFn,
      confirmMessageId: true,
    });
    expect(result.messageId).toBe("media-id");
    const lookup = fetchFn.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/messages"));
    expect(lookup).toContain("/groups/cfg-group/messages");
  });

  it("skips the lookup without an access token or when not requested", async () => {
    const withoutToken = routedFetch([botMessage({ id: "unused", text: "x" })]);
    const unconfirmed = await sendGroupMeText({
      cfg: cfg({ botId: "bot-1" }),
      to: "g1",
      text: "x",
      fetchFn: withoutToken,
      confirmMessageId: true,
    });
    expect(unconfirmed.messageId).toBe("");
    expect(withoutToken).toHaveBeenCalledTimes(1);

    const notRequested = routedFetch([botMessage({ id: "unused", text: "x" })]);
    const plain = await sendGroupMeText({
      cfg: cfg({ botId: "bot-1", accessToken: "token-1" }),
      to: "g1",
      text: "x",
      fetchFn: notRequested,
    });
    expect(plain.messageId).toBe("");
    expect(notRequested).toHaveBeenCalledTimes(1);
  });
});
