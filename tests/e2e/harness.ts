import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createTempProject, packTarball, repoRoot, run } from "../integration/helpers/package.js";

/**
 * End-to-end harness: installs the packed plugin into an isolated OpenClaw home,
 * runs a real `openclaw gateway run`, and drives it through the GroupMe webhook.
 * The agent model is a local OpenAI-compatible stub that answers `pong <nonce>`,
 * so a turn is observable without model credentials.
 */

export const NONCE_PATTERN = /gme2e-[a-z0-9-]+/gi;

export const openclawCli = join(repoRoot, "node_modules", "openclaw", "openclaw.mjs");

type JsonObject = Record<string, unknown>;

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" ? String((part as JsonObject).text ?? "") : "",
      )
      .join("");
  }
  return "";
}

/** Latest nonce the user sent, ignoring earlier turns and buffered history. */
export function latestUserNonce(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== "object" || (message as JsonObject).role !== "user") {
      continue;
    }
    const text = messageText((message as JsonObject).content);
    // OpenClaw appends an internal-context user message (conversation info and
    // buffered group history); the nonce the user just sent lives in the turn body.
    if (text.includes("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>")) {
      continue;
    }
    const hits = text.match(NONCE_PATTERN);
    if (hits?.length) {
      return hits[hits.length - 1];
    }
  }
  return undefined;
}

export type MockModel = {
  baseUrl: string;
  requests: JsonObject[];
  close: () => Promise<void>;
};

/**
 * OpenAI-compatible chat completions stub (streaming and non-streaming). A nonce
 * labelled `media` also gets a `MEDIA:` directive so the reply carries an image
 * (an https URL or a path inside the agent workspace).
 */
export async function startMockModel(options: { media?: string } = {}): Promise<MockModel> {
  const requests: JsonObject[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url?.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
      return;
    }
    let parsed: JsonObject = {};
    try {
      parsed = JSON.parse(body || "{}") as JsonObject;
    } catch {
      // Leave parsed empty; the reply below still completes the turn.
    }
    requests.push(parsed);
    const nonce = latestUserNonce(parsed.messages) ?? "no-nonce";
    const reply =
      options.media && nonce.startsWith("gme2e-media-")
        ? `pong ${nonce}\nMEDIA:${options.media}`
        : `pong ${nonce}`;
    const base = {
      id: "chatcmpl-mock",
      created: Math.floor(Date.now() / 1000),
      model: String(parsed.model ?? "mock-model"),
    };
    const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };
    if (parsed.stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const chunk = (payload: JsonObject) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      chunk({
        ...base,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
      });
      chunk({
        ...base,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage,
      });
      res.end("data: [DONE]\n\n");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ...base,
        object: "chat.completion",
        choices: [
          { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
        ],
        usage,
      }),
    );
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, close: () => close(server) };
}

export type FakeGroupMe = {
  baseUrl: string;
  posts: JsonObject[];
  uploads: Array<{ contentType?: string; bytes: number; accessToken?: string }>;
  close: () => Promise<void>;
};

/** Stand-in for api.groupme.com / image.groupme.com that records bot posts. */
/** 1x1 transparent PNG. */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export async function startFakeGroupMe(): Promise<FakeGroupMe> {
  const posts: JsonObject[] = [];
  const uploads: FakeGroupMe["uploads"] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/pictures") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      uploads.push({
        contentType: req.headers["content-type"],
        bytes: Buffer.concat(chunks).length,
        accessToken: req.headers["x-access-token"] as string | undefined,
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ payload: { picture_url: "https://i.groupme.com/1x1.png.fake" } }));
      return;
    }
    const body = await readBody(req);
    if (req.method === "POST" && req.url === "/v3/bots/post") {
      posts.push(JSON.parse(body) as JsonObject);
      res.statusCode = 202;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}`, posts, uploads, close: () => close(server) };
}

/**
 * Preload module for the gateway process that points the GroupMe hosts at the
 * fake API. It only runs inside the hermetic test gateway; the plugin itself has
 * no test hooks.
 */
const INTERCEPTOR_SOURCE = `
const base = process.env.GROUPME_E2E_API_BASE;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (base && /^https:\\/\\/(api|image)\\.groupme\\.com\\//.test(url)) {
    return realFetch(url.replace(/^https:\\/\\/(api|image)\\.groupme\\.com/, base), init);
  }
  return realFetch(input, init);
};
`;

export type OpenClawHome = {
  home: string;
  env: NodeJS.ProcessEnv;
  configPath: string;
};

export function isolatedEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: home,
    // Pin state to this home even when the test process sets OPENCLAW_STATE_DIR.
    OPENCLAW_STATE_DIR: join(home, ".openclaw"),
    NO_COLOR: "1",
    OPENCLAW_DISABLE_BONJOUR: "1",
    VITEST: "",
    VITEST_WORKER_ID: "",
    ...extra,
  };
}

/** Installs the packed plugin (with capability consent) into a fresh OpenClaw home. */
export function installPluginHome(prefix: string, extraEnv: NodeJS.ProcessEnv = {}): OpenClawHome {
  const home = createTempProject(prefix);
  const env = isolatedEnv(home, extraEnv);
  const tarball = packTarball(home);
  run(
    process.execPath,
    [openclawCli, "plugins", "install", tarball, "--force", "--accept-capabilities"],
    { env },
  );
  return { home, env, configPath: join(home, ".openclaw", "openclaw.json") };
}

export function writeGatewayConfig(params: {
  home: OpenClawHome;
  gatewayPort: number;
  modelBaseUrl: string;
  groupme: JsonObject;
}): void {
  const config = JSON.parse(readFileSync(params.home.configPath, "utf8")) as JsonObject;
  config.gateway = {
    mode: "local",
    port: params.gatewayPort,
    bind: "loopback",
    auth: { mode: "token", token: randomBytes(16).toString("hex") },
  };
  config.agents = { defaults: { model: { primary: "mock/mock-model" } } };
  config.models = {
    mode: "merge",
    providers: {
      mock: {
        baseUrl: params.modelBaseUrl,
        apiKey: "mock",
        api: "openai-completions",
        models: [
          {
            id: "mock-model",
            name: "Mock",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 1024,
          },
        ],
      },
    },
  };
  config.channels = { groupme: { enabled: true, ...params.groupme } };
  writeFileSync(params.home.configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export type RunningGateway = {
  port: number;
  output: () => string;
  stop: () => Promise<void>;
};

export async function startGateway(params: {
  home: OpenClawHome;
  port: number;
  fakeGroupMeBaseUrl?: string;
  readyTimeoutMs?: number;
}): Promise<RunningGateway> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...params.home.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("OPENCLAW_") && !(key in params.home.env)) {
      delete env[key];
    }
  }
  if (params.fakeGroupMeBaseUrl) {
    const interceptor = join(params.home.home, "groupme-e2e-intercept.mjs");
    writeFileSync(interceptor, INTERCEPTOR_SOURCE);
    env.GROUPME_E2E_API_BASE = params.fakeGroupMeBaseUrl;
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${interceptor}`.trim();
  }

  let output = "";
  const child: ChildProcess = spawn(
    process.execPath,
    [openclawCli, "gateway", "run", "--port", String(params.port)],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk;
  });

  const stop = async () => {
    if (child.exitCode !== null || child.pid === undefined) {
      return;
    }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    // The gateway forks helpers (spawn broker, workers); signal the whole group.
    process.kill(-child.pid, "SIGTERM");
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 15_000);
    await exited;
    clearTimeout(timer);
  };

  const deadline = Date.now() + (params.readyTimeoutMs ?? 120_000);
  while (!output.includes("GroupMe webhook listening on")) {
    if (child.exitCode !== null) {
      throw new Error(`gateway exited early (${child.exitCode}):\n${output}`);
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`gateway did not register the GroupMe webhook in time:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { port: params.port, output: () => output, stop };
}

export function callbackPayload(overrides: JsonObject & { group_id: string; text: string }) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    attachments: [],
    avatar_url: null,
    created_at: Math.floor(Date.now() / 1000),
    id,
    name: "E2E Tester",
    sender_id: "12345",
    sender_type: "user",
    source_guid: `e2e-${id}`,
    system: false,
    user_id: "12345",
    ...overrides,
  };
}

export async function postCallback(params: {
  port: number;
  callbackToken: string;
  payload: unknown;
  path?: string;
}): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${params.port}${params.path ?? "/groupme"}?k=${encodeURIComponent(params.callbackToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params.payload),
    },
  );
}

export async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  params: { timeoutMs: number; intervalMs?: number; description: string },
): Promise<T> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, params.intervalMs ?? 500));
  }
  throw new Error(`timed out waiting for ${params.description}`);
}

export function newNonce(label: string): string {
  return `gme2e-${label}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}
