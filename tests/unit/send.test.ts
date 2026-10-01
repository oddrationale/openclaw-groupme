import { SsrFBlockedError } from "openclaw/plugin-sdk/ssrf-runtime";
import { describe, expect, it, vi } from "vitest";
import { setGroupMeRuntime } from "../../src/runtime.js";
import {
  sendGroupMeMedia,
  sendGroupMeMessage,
  sendGroupMeText,
  uploadGroupMeImage,
} from "../../src/send.js";
import type { CoreConfig } from "../../src/types.js";
import { requestJson, requestUrl } from "../helpers/fetch.js";

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
    expect(requestUrl(url)).toBe("https://api.groupme.com/v3/bots/post");
    const body = requestJson(options) as Record<string, unknown>;
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
    const body = requestJson(options) as Record<string, unknown>;
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

  it("throws when picture_url is blank", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ payload: { picture_url: "   " } })),
    );

    await expect(
      uploadGroupMeImage({
        accessToken: "token",
        imageData: Buffer.from("img"),
        fetchFn: fetchMock,
      }),
    ).rejects.toThrow("no picture_url in response");
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

    const fetchMock = vi.fn(
      async () =>
        new Response("text", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
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

  it("blocks media downloads without a content type", async () => {
    const fetchMock = vi.fn(async () => {
      const response = new Response(Buffer.from("img"));
      response.headers.delete("content-type");
      return response;
    });

    await expect(
      sendGroupMeMedia({
        cfg: { channels: { groupme: { botId: "bot-1", accessToken: "token-1" } } },
        to: "any",
        text: "",
        mediaUrl: "https://example.com/unknown",
        fetchFn: fetchMock,
      }),
    ).rejects.toThrow("MIME policy (missing content-type)");
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

    const fetchMock = vi.fn(
      async () =>
        new Response(Buffer.from("image-bytes"), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "11",
          },
        }),
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
            readRemoteMediaBuffer: vi.fn(async () => {
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
            readRemoteMediaBuffer: vi.fn(async () => ({
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

      const readRemoteMediaBuffer = vi.fn(async () => ({
        buffer: Buffer.from("img"),
        contentType: "image/png",
      }));
      setGroupMeRuntime({
        channel: {
          media: {
            readRemoteMediaBuffer,
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

      expect(readRemoteMediaBuffer).toHaveBeenCalledWith({
        url: "https://example.com/image.png",
        fetchImpl: fetchMock,
        maxBytes: 1024,
        maxRedirects: 3,
        timeoutMs: 10_000,
        ssrfPolicy: { allowPrivateNetwork: false },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      // Reset the global GroupMe runtime to avoid cross-test interference.
      setGroupMeRuntime(undefined as unknown as Parameters<typeof setGroupMeRuntime>[0]);
    }
  });

  it("downloads non-streaming media bodies that fit under the limit", async () => {
    const cfg: CoreConfig = {
      channels: { groupme: { botId: "bot-1", accessToken: "token-1" } },
    };
    const download = new Response(Buffer.from("img"), {
      headers: { "content-type": "image/png" },
    });
    Object.defineProperty(download, "body", { value: null });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(download)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payload: { picture_url: "https://i.groupme.com/new" } }), {
          status: 200,
        }),
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
  });

  it("arms a request timeout around the media download fetch", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
          security: { media: { requestTimeoutMs: 1 } },
        },
      },
    };
    const slowDownload = () =>
      new Promise<Response>((resolve) => {
        setTimeout(
          () =>
            resolve(new Response(Buffer.from("img"), { headers: { "content-type": "image/png" } })),
          10,
        );
      });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(slowDownload)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payload: { picture_url: "https://i.groupme.com/new" } }), {
          status: 200,
        }),
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
  });

  it("rethrows non-Error runtime media failures unchanged", async () => {
    try {
      const cfg: CoreConfig = {
        channels: { groupme: { botId: "bot-1", accessToken: "token-1" } },
      };
      setGroupMeRuntime({
        channel: {
          media: {
            readRemoteMediaBuffer: vi.fn(async () => {
              // oxlint-disable-next-line typescript/only-throw-error -- exercises the non-Error rejection path
              throw "string failure";
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
      ).rejects.toBe("string failure");
    } finally {
      setGroupMeRuntime(undefined as unknown as Parameters<typeof setGroupMeRuntime>[0]);
    }
  });

  it("maps a runtime SsrFBlockedError instance to the SSRF policy error", async () => {
    try {
      const cfg: CoreConfig = {
        channels: { groupme: { botId: "bot-1", accessToken: "token-1" } },
      };
      setGroupMeRuntime({
        channel: {
          media: {
            readRemoteMediaBuffer: vi.fn(async () => {
              throw new SsrFBlockedError("blocked by runtime");
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

  it("skips empty stream chunks while reading media bodies", async () => {
    const cfg: CoreConfig = {
      channels: {
        groupme: {
          botId: "bot-1",
          accessToken: "token-1",
          security: { media: { maxDownloadBytes: 1024 } },
        },
      },
    };

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([]));
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(body, { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payload: { picture_url: "https://i.groupme.com/new" } }), {
          status: 200,
        }),
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
  });
});

function okFetchSequence(order: string[]) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = requestUrl(input);
    order.push(`fetch:${url}`);
    if (url.endsWith("/pictures")) {
      return new Response(JSON.stringify({ payload: { picture_url: "https://i.groupme.com/p" } }));
    }
    if (url.endsWith("/bots/post")) {
      return new Response("", { status: 202, statusText: "Accepted" });
    }
    return new Response(Buffer.from("img"), { headers: { "content-type": "image/png" } });
  });
}

function uploadContentType(fetchMock: ReturnType<typeof okFetchSequence>): string | undefined {
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
  return headers?.["Content-Type"];
}

describe("host delivery fences", () => {
  it("runs onPlatformSendDispatch then assertDirectAdapterHandoff right before the post", async () => {
    const order: string[] = [];
    const fetchMock = okFetchSequence(order);
    const controller = new AbortController();

    const result = await sendGroupMeMessage({
      botId: "bot-1",
      text: "hello",
      fetchFn: fetchMock,
      signal: controller.signal,
      onPlatformSendDispatch: async () => {
        order.push("dispatch");
      },
      assertDirectAdapterHandoff: () => {
        order.push("handoff");
      },
    });

    expect(order).toEqual(["dispatch", "handoff", "fetch:https://api.groupme.com/v3/bots/post"]);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    // The Bot API returns 202 with no body: no platform message id is fabricated.
    expect(result).toEqual({ messageId: "", timestamp: expect.any(Number) });
  });

  it("does not post when the handoff assertion fails", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));

    await expect(
      sendGroupMeMessage({
        botId: "bot-1",
        text: "hello",
        fetchFn: fetchMock,
        assertDirectAdapterHandoff: () => {
          throw new Error("send authority revoked");
        },
      }),
    ).rejects.toThrow("send authority revoked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not claim or post when the signal is already aborted", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    const onPlatformSendDispatch = vi.fn(async () => undefined);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      sendGroupMeMessage({
        botId: "bot-1",
        text: "hello",
        fetchFn: fetchMock,
        signal: controller.signal,
        onPlatformSendDispatch,
      }),
    ).rejects.toThrow("cancelled");
    expect(onPlatformSendDispatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards fences through sendGroupMeText", async () => {
    const order: string[] = [];
    const fetchMock = okFetchSequence(order);

    const result = await sendGroupMeText({
      cfg: { channels: { groupme: { botId: "bot-1" } } },
      to: "g1",
      text: "hello",
      fetchFn: fetchMock,
      onPlatformSendDispatch: async () => {
        order.push("dispatch");
      },
      assertDirectAdapterHandoff: () => {
        order.push("handoff");
      },
    });

    expect(order).toEqual(["dispatch", "handoff", "fetch:https://api.groupme.com/v3/bots/post"]);
    expect(result.messageId).toBe("");
  });

  it("fences only the final post of a media send, after download and upload", async () => {
    const order: string[] = [];
    const fetchMock = okFetchSequence(order);

    const result = await sendGroupMeMedia({
      cfg: { channels: { groupme: { botId: "bot-1", accessToken: "token-1" } } },
      to: "g1",
      text: "caption",
      mediaUrl: "https://example.com/image.png",
      fetchFn: fetchMock,
      onPlatformSendDispatch: async () => {
        order.push("dispatch");
      },
      assertDirectAdapterHandoff: () => {
        order.push("handoff");
      },
    });

    expect(order).toEqual([
      "fetch:https://example.com/image.png",
      "fetch:https://image.groupme.com/pictures",
      "dispatch",
      "handoff",
      "fetch:https://api.groupme.com/v3/bots/post",
    ]);
    expect(result.messageId).toBe("");
  });

  it("stops a media send before uploading once the signal aborts", async () => {
    const order: string[] = [];
    const fetchMock = okFetchSequence(order);
    const controller = new AbortController();
    const mediaReadFile = vi.fn(async () => {
      controller.abort(new Error("cancelled mid-send"));
      return Buffer.from("img");
    });

    await expect(
      sendGroupMeMedia({
        cfg: { channels: { groupme: { botId: "bot-1", accessToken: "token-1" } } },
        to: "g1",
        text: "",
        mediaUrl: "/tmp/picture.png",
        mediaReadFile,
        fetchFn: fetchMock,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled mid-send");
    expect(order).toEqual([]);
  });
});

describe("local media via host mediaReadFile", () => {
  const cfg: CoreConfig = {
    channels: {
      groupme: {
        botId: "bot-1",
        accessToken: "token-1",
        security: { media: { maxDownloadBytes: 8 } },
      },
    },
  };

  it("reads local paths through the host reader and uploads with the inferred MIME type", async () => {
    const order: string[] = [];
    const fetchMock = okFetchSequence(order);
    const mediaReadFile = vi.fn(async () => Buffer.from("png"));

    await sendGroupMeMedia({
      cfg,
      to: "g1",
      text: "chart",
      mediaUrl: " /workspace/out/Chart.PNG ",
      mediaReadFile,
      fetchFn: fetchMock,
    });

    expect(mediaReadFile).toHaveBeenCalledWith("/workspace/out/Chart.PNG");
    expect(order).toEqual([
      "fetch:https://image.groupme.com/pictures",
      "fetch:https://api.groupme.com/v3/bots/post",
    ]);
    expect(uploadContentType(fetchMock)).toBe("image/png");
    const post = requestJson(fetchMock.mock.calls[1]?.[1]);
    expect(post).toEqual({
      bot_id: "bot-1",
      text: "chart",
      picture_url: "https://i.groupme.com/p",
    });
  });

  it("converts file:// URLs to paths and maps jpeg extensions", async () => {
    const fetchMock = okFetchSequence([]);
    const mediaReadFile = vi.fn(async () => Buffer.from("jpg"));

    await sendGroupMeMedia({
      cfg,
      to: "g1",
      text: "",
      mediaUrl: "file:///tmp/my%20photo.jpeg",
      mediaReadFile,
      fetchFn: fetchMock,
    });

    expect(mediaReadFile).toHaveBeenCalledWith("/tmp/my photo.jpeg");
    expect(uploadContentType(fetchMock)).toBe("image/jpeg");
  });

  it("refuses local media when the host provides no reader", async () => {
    const fetchMock = vi.fn(async () => new Response(""));

    await expect(
      sendGroupMeMedia({ cfg, to: "g1", text: "", mediaUrl: "/etc/passwd", fetchFn: fetchMock }),
    ).rejects.toThrow("GroupMe media send requires an http(s) mediaUrl for this delivery");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects local files over maxDownloadBytes", async () => {
    await expect(
      sendGroupMeMedia({
        cfg,
        to: "g1",
        text: "",
        mediaUrl: "/tmp/big.png",
        mediaReadFile: async () => Buffer.alloc(9),
      }),
    ).rejects.toThrow("GroupMe media exceeds maxDownloadBytes (9 > 8)");
  });

  it("rejects local files whose extension is not an allowed image type", async () => {
    await expect(
      sendGroupMeMedia({
        cfg,
        to: "g1",
        text: "",
        mediaUrl: "/tmp/notes.txt",
        mediaReadFile: async () => Buffer.from("hi"),
      }),
    ).rejects.toThrow("GroupMe media download blocked by MIME policy (missing content-type)");
  });
});
