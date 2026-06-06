import { describe, expect, it, vi } from "vitest";
import { setGroupMeRuntime } from "../../src/runtime.js";
import {
  sendGroupMeMedia,
  sendGroupMeMessage,
  sendGroupMeText,
  uploadGroupMeImage,
} from "../../src/send.js";
import type { CoreConfig } from "../../src/types.js";

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
      async () => new Response("bad", { status: 400, statusText: "Bad Request" }),
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

  it("throws when image upload fails", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 500 }));

    await expect(
      uploadGroupMeImage({
        accessToken: "token",
        imageData: Buffer.from("abc"),
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("GroupMe image upload failed: 500");
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://image.groupme.com/pictures");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.groupme.com/v3/bots/post");
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

  it("throws when text send is missing botId", async () => {
    await expect(
      sendGroupMeText({
        cfg: { channels: { groupme: {} } } as CoreConfig,
        to: "any",
        text: "hello",
      }),
    ).rejects.toThrow('GroupMe account "default" is missing botId');
  });

  it("throws when media send is missing botId or accessToken", async () => {
    await expect(
      sendGroupMeMedia({
        cfg: { channels: { groupme: { accessToken: "token-1" } } } as CoreConfig,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/image.png",
      }),
    ).rejects.toThrow('GroupMe account "default" is missing botId');

    await expect(
      sendGroupMeMedia({
        cfg: { channels: { groupme: { botId: "bot-1" } } } as CoreConfig,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/image.png",
      }),
    ).rejects.toThrow("missing accessToken");
  });

  it("throws when remote media download returns a non-ok response", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
        },
      },
    };
    const fetchMock = vi.fn(
      async () => new Response("missing", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      sendGroupMeMedia({
        cfg,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/missing.png",
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("GroupMe media download failed: 404 Not Found");
  });

  it("blocks runtime media fetch SSRF errors", async () => {
    try {
      const cfg: CoreConfig = {
        channels: {
          groupme: {
            botId: "bot-1",
            accessToken: "token-1",
          },
        },
      };
      setGroupMeRuntime({
        channel: {
          media: {
            fetchRemoteMedia: vi.fn(async () => {
              throw new Error("ssrf blocked by runtime");
            }),
          },
        },
      } as unknown as Parameters<typeof setGroupMeRuntime>[0]);

      await expect(
        sendGroupMeMedia({
          cfg,
          to: "any",
          text: "caption",
          mediaUrl: "https://example.com/image.png",
        }),
      ).rejects.toThrow("SSRF policy");
    } finally {
      setGroupMeRuntime(undefined as unknown as Parameters<typeof setGroupMeRuntime>[0]);
    }
  });

  it("enforces MIME policy on runtime media fetch results", async () => {
    try {
      const cfg: CoreConfig = {
        channels: {
          groupme: {
            botId: "bot-1",
            accessToken: "token-1",
          },
        },
      };
      setGroupMeRuntime({
        channel: {
          media: {
            fetchRemoteMedia: vi.fn(async () => ({
              buffer: Buffer.from("text"),
              contentType: "text/plain; charset=utf-8",
            })),
          },
        },
      } as unknown as Parameters<typeof setGroupMeRuntime>[0]);

      await expect(
        sendGroupMeMedia({
          cfg,
          to: "any",
          text: "caption",
          mediaUrl: "https://example.com/file.txt",
        }),
      ).rejects.toThrow("MIME policy");
    } finally {
      setGroupMeRuntime(undefined as unknown as Parameters<typeof setGroupMeRuntime>[0]);
    }
  });

  it("aborts oversized streamed media bodies while preserving the size error", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
          security: {
            media: {
              maxDownloadBytes: 4,
            },
          },
        },
      },
    };

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      },
    });
    const fetchMock = vi.fn(
      async () => new Response(body, { headers: { "content-type": "image/png" } }),
    );

    await expect(
      sendGroupMeMedia({
        cfg,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/large.png",
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("maxDownloadBytes");
  });

  it("rejects oversized non-streaming media bodies", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
          security: {
            media: {
              maxDownloadBytes: 4,
            },
          },
        },
      },
    };

    const response = new Response(Buffer.from("too-large"), {
      headers: { "content-type": "image/png" },
    });
    Object.defineProperty(response, "body", { value: null });
    const fetchMock = vi.fn(async () => response);

    await expect(
      sendGroupMeMedia({
        cfg,
        to: "any",
        text: "caption",
        mediaUrl: "https://example.com/non-streaming.png",
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("maxDownloadBytes");
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
