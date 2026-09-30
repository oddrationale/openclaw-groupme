import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { importBuilt } from "./helpers/package.js";

type BuiltChannelPlugin = {
  id: string;
  meta?: { id?: string };
  setupWizard?: unknown;
  setupContract?: {
    kind?: string;
    validateInput?: (params: { cfg: unknown; accountId: string; input: unknown }) => string | null;
    applyAccountConfig?: unknown;
  };
  capabilities?: { chatTypes?: string[]; media?: boolean };
  configSchema: {
    schema?: unknown;
    runtime: { safeParse(input: unknown): { success: boolean; error?: unknown } };
  };
  config: {
    resolveAccount(cfg: unknown, accountId?: string): { configured: boolean };
    describeAccount(account: unknown): Record<string, unknown>;
  };
  gateway?: { startAccount?: unknown };
  outbound?: { sendText?: unknown; sendMedia?: unknown };
  message?: { send?: { text?: unknown; media?: unknown } };
  secrets?: unknown;
};

type BuiltEntry = {
  id: string;
  name: string;
  description: string;
  register(api: unknown): void;
  channelPlugin: BuiltChannelPlugin;
  setChannelRuntime?: (runtime: unknown) => void;
};

async function loadEntry(): Promise<BuiltEntry> {
  return (await importBuilt<{ default: BuiltEntry }>("dist/index.js")).default;
}

describe("built OpenClaw plugin contract", () => {
  it("exposes a channel plugin entry through the packaged runtime entrypoint", async () => {
    const entry = await loadEntry();

    expect(entry).toEqual(
      expect.objectContaining({
        id: "groupme",
        name: "GroupMe",
        description: "GroupMe channel plugin",
      }),
    );
    expect(entry.register).toBeTypeOf("function");
    expect(entry.setChannelRuntime).toBeTypeOf("function");
    expect(entry.channelPlugin.id).toBe("groupme");
    // Not the legacy bundled-channel entry shape.
    expect(entry).not.toHaveProperty("kind");
    expect(entry).not.toHaveProperty("loadChannelPlugin");
  }, 60_000);

  it("registers the channel and hands the host runtime to the built runtime store", async () => {
    const entry = await loadEntry();
    const { tryGetGroupMeRuntime } = await importBuilt<{
      tryGetGroupMeRuntime: () => unknown;
    }>("dist/src/runtime.js");
    const runtime = { host: "fake" };
    const registerChannel = vi.fn();

    entry.register({ registrationMode: "full", runtime, registerChannel });

    expect(registerChannel).toHaveBeenCalledWith({ plugin: entry.channelPlugin });
    expect(tryGetGroupMeRuntime()).toBe(runtime);
  }, 60_000);

  it("exposes the runtime channel surface OpenClaw loads", async () => {
    const plugin = (await loadEntry()).channelPlugin;

    expect(plugin.capabilities).toEqual(
      expect.objectContaining({
        chatTypes: ["group"],
        media: true,
      }),
    );
    expect(plugin.setupWizard).toBeDefined();
    expect(plugin.setupContract?.kind).toBe("channel-owned");
    expect(plugin.setupContract?.validateInput).toBeTypeOf("function");
    expect(plugin.setupContract?.applyAccountConfig).toBeTypeOf("function");
    expect(plugin.configSchema?.runtime?.safeParse).toBeTypeOf("function");
    expect(plugin.gateway?.startAccount).toBeTypeOf("function");
    expect(plugin.outbound?.sendText).toBeTypeOf("function");
    expect(plugin.outbound?.sendMedia).toBeTypeOf("function");
    expect(plugin.message?.send?.text).toBeTypeOf("function");
    expect(plugin.message?.send?.media).toBeTypeOf("function");
  }, 60_000);

  it("exposes a setup-only entry with the setup-safe plugin surface", async () => {
    const setup = await importBuilt<{ default: { plugin: BuiltChannelPlugin } }>(
      "dist/setup-entry.js",
    );
    const plugin = setup.default.plugin;

    expect(Object.keys(setup.default)).toEqual(["plugin"]);
    expect(plugin.id).toBe("groupme");
    expect(plugin.setupContract?.validateInput).toBeTypeOf("function");
    expect(
      plugin.setupContract?.validateInput?.({
        cfg: {},
        accountId: DEFAULT_ACCOUNT_ID,
        input: { token: "bot-1" },
      }),
    ).toBeNull();
    expect(plugin.setupWizard).toBeDefined();
    expect(plugin.secrets).toBeDefined();
    expect(plugin.gateway).toBeUndefined();
    expect(plugin.outbound).toBeUndefined();
  }, 60_000);

  it("accepts modern config with OpenClaw secret input references", async () => {
    const groupmePlugin = (await loadEntry()).channelPlugin;

    const cfg = {
      channels: {
        groupme: {
          enabled: true,
          botId: { source: "env", provider: "default", id: "GROUPME_BOT_ID" },
          accessToken: {
            source: "env",
            provider: "default",
            id: "GROUPME_ACCESS_TOKEN",
          },
          callbackToken: {
            source: "env",
            provider: "default",
            id: "GROUPME_CALLBACK_TOKEN",
          },
          groupId: "123456",
          publicDomain: "https://example.test",
          webhookPath: "/groupme",
          requireMention: true,
        },
      },
    };

    expect(groupmePlugin.configSchema.runtime.safeParse(cfg.channels.groupme).success).toBe(true);
    expect(groupmePlugin.configSchema.runtime.safeParse({ unknownKey: true }).success).toBe(false);

    const account = groupmePlugin.config.resolveAccount(cfg, DEFAULT_ACCOUNT_ID);
    expect(account.configured).toBe(true);
    expect(groupmePlugin.config.describeAccount(account)).toEqual(
      expect.objectContaining({
        accountId: DEFAULT_ACCOUNT_ID,
        botId: "***",
        callbackToken: "***",
        configured: true,
        webhookPath: "/groupme",
      }),
    );
  }, 60_000);

  it("exposes the secret target registry sidecar", async () => {
    const secrets = await importBuilt<{
      channelSecrets: { secretTargetRegistryEntries: Array<{ id: string }> };
    }>("dist/secret-contract-api.js");

    expect(
      secrets.channelSecrets.secretTargetRegistryEntries.map((entry) => entry.id).toSorted(),
    ).toEqual([
      "channels.groupme.accessToken",
      "channels.groupme.accounts.*.accessToken",
      "channels.groupme.accounts.*.botId",
      "channels.groupme.accounts.*.callbackToken",
      "channels.groupme.botId",
      "channels.groupme.callbackToken",
    ]);
  }, 60_000);
});
