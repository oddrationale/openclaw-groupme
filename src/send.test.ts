import { describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "./types.js";
import { setGroupMeRuntime } from "./runtime.js";
import {
  sendGroupMeMedia,
  sendGroupMeMessage,
  sendGroupMeText,
  uploadGroupMeImage,
} from "./send.js";

describe("sendGroupMeMessage", () => {
  it("sends text message", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("", { status: 201, statusText: "Created" }),
    );

    await sendGroupMeMessage({
      botId: "bot-1",
      text: "hello",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("missing fetch call");
    }
    const [url, options] = firstCall;
    expect(String(url)).toBe("https://api.groupme.com/v3/bots/post");
    const body = JSON.parse(String(options?.body));
    expect(body).toEqual({ bot_id: "bot-1", text: "hello" });
  });

  it("sends message with picture_url", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("", { status: 202, statusText: "Accepted" }),
    );

    await sendGroupMeMessage({
      botId: "bot-1",
      text: "image",
      pictureUrl: "https://i.groupme.com/abc",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("missing fetch call");
    }
    const [, options] = firstCall;
    const body = JSON.parse(String(options?.body));
    expect(body.picture_url).toBe("https://i.groupme.com/abc");
  });

  it("throws on API error", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("bad", { status: 400, statusText: "Bad Request" }),
    );

    await expect(
      sendGroupMeMessage({
        botId: "bot-1",
        text: "hello",
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("GroupMe API error");
  });
});

describe("uploadGroupMeImage", () => {
  it("uploads and returns picture_url", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            payload: { picture_url: "https://i.groupme.com/pic" },
          }),
          {
            status: 200,
          },
        ),
    );

    const result = await uploadGroupMeImage({
      accessToken: "token",
      imageData: Buffer.from("abc"),
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(result).toBe("https://i.groupme.com/pic");
  });

  it("throws when picture_url is missing", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ payload: {} }), {
          status: 200,
        }),
    );

    await expect(
      uploadGroupMeImage({
        accessToken: "token",
        imageData: Buffer.from("abc"),
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("no picture_url");
  });
});

describe("high-level send helpers", () => {
  it("sends text using resolved account", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
        },
      },
    };

    const fetchMock = vi.fn(async () => new Response("", { status: 201 }));

    await sendGroupMeText({
      cfg,
      to: "any",
      text: "hello",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends media by downloading then uploading", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
        },
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(Buffer.from("img"), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payload: { picture_url: "https://i.groupme.com/new" },
          }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 201 }));

    await sendGroupMeMedia({
      cfg,
      to: "any",
      text: "caption",
      mediaUrl: "https://example.com/image.png",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/image.png");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://image.groupme.com/pictures",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://api.groupme.com/v3/bots/post",
    );
  });

  it("blocks non-image media content types", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
        },
      },
    };

    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response("text", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    await expect(
      sendGroupMeMedia({
        cfg,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/file.txt",
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("MIME policy");
  });

  it("blocks oversized media downloads", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
          security: {
            media: {
              maxDownloadBytes: 2,
            },
          },
        },
      },
    };

    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(Buffer.from("image-bytes"), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "11",
          },
        }),
      ),
    );

    await expect(
      sendGroupMeMedia({
        cfg,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/image.png",
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("maxDownloadBytes");
  });

  it("blocks private-network media URLs by default", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
        },
      },
    };
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));

    await expect(
      sendGroupMeMedia({
        cfg,
        to: "any",
        text: "caption",
        mediaUrl: "http://127.0.0.1/private.png",
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("SSRF policy");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses runtime media fetch helper when runtime is available", async () => {
    try {
      const cfg: CoreConfig = {
        channels: {
          groupme: {
            botId: "bot-1",
            accessToken: "token-1",
            security: {
              media: {
                maxDownloadBytes: 1024,
              },
            },
          },
        },
      };

      const fetchRemoteMedia = vi.fn(async () => ({
        buffer: Buffer.from("img"),
        contentType: "image/png",
      }));
      setGroupMeRuntime({
        channel: {
          media: {
            fetchRemoteMedia,
          },
        },
      } as unknown as Parameters<typeof setGroupMeRuntime>[0]);

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              payload: { picture_url: "https://i.groupme.com/new" },
            }),
            {
              status: 200,
            },
          ),
        )
        .mockResolvedValueOnce(new Response("", { status: 201 }));

      await sendGroupMeMedia({
        cfg,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/image.png",
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      expect(fetchRemoteMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/image.png",
          maxBytes: 1024,
          maxRedirects: 3,
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      // Reset the global GroupMe runtime to avoid cross-test interference.
      setGroupMeRuntime(undefined as unknown as Parameters<typeof setGroupMeRuntime>[0]);
    }
  });
});
