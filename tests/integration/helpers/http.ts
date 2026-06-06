import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type RecordedRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: string;
  json: unknown;
};

export type TestHttpServer = {
  baseUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
};

export type NodeHandlerServer = {
  baseUrl: string;
  close(): Promise<void>;
};

export async function startTestHttpServer(
  handler: (request: RecordedRequest, response: ServerResponse) => void | Promise<void>,
): Promise<TestHttpServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) {
      chunks.push(Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    let json: unknown = null;
    if (body) {
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }
    }

    const url = new URL(incoming.url ?? "/", "http://localhost");
    const request: RecordedRequest = {
      method: incoming.method ?? "",
      path: url.pathname,
      query: url.searchParams,
      headers: incoming.headers,
      body,
      json,
    };
    requests.push(request);

    try {
      await handler(request, response);
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Unable to determine test HTTP server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
}

export async function startNodeHandlerServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<NodeHandlerServer> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Unable to determine test HTTP server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
