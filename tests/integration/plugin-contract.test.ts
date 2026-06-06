import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import { importBuilt } from "./helpers/package.js";

describe("built OpenClaw plugin contract", () => {
  it("exposes the bundled channel entry through the packaged runtime entrypoint", async () => {
    const mod = await importBuilt<{ default: Record<string, unknown> }>("dist/index.js");

    expect(mod.default).toEqual(
      expect.objectContaining({
        kind: "bundled-channel-entry",
        id: "groupme",
        name: "GroupMe",
        description: "GroupMe channel plugin",
      }),
    );
    expect(mod.default.loadChannelPlugin).toBeTypeOf("function");
    expect(mod.default.loadChannelSecrets).toBeTypeOf("function");
    expect(mod.default.setChannelRuntime).toBeTypeOf("function");
  });

  it("exposes setup and channel sidecars OpenClaw can import directly", async () => {
    const setup = await importBuilt<{ default: Record<string, unknown> }>("dist/setup-entry.js");
    const channel = await importBuilt<{
      groupmePlugin: {
        id: string;
        setupWizard?: unknown;
        setup?: { validateInput?: unknown };
        capabilities?: { chatTypes?: string[]; media?: boolean };
        configSchema?: { runtime?: { safeParse?: unknown } };
        gateway?: { startAccount?: unknown };
        outbound?: { sendText?: unknown; sendMedia?: unknown };
      };
    }>("dist/channel-plugin-api.js");

    expect(setup.default).toEqual(
      expect.objectContaining({
        kind: "bundled-channel-setup-entry",
      }),
    );
    expect(channel.groupmePlugin.id).toBe("groupme");
    expect(channel.groupmePlugin.capabilities).toEqual(
      expect.objectContaining({
        chatTypes: ["group"],
        media: true,
      }),
    );
    expect(channel.groupmePlugin.setupWizard).toBeDefined();
    expect(channel.groupmePlugin.setup?.validateInput).toBeTypeOf("function");
    expect(channel.groupmePlugin.configSchema?.runtime?.safeParse).toBeTypeOf("function");
    expect(channel.groupmePlugin.gateway?.startAccount).toBeTypeOf("function");
    expect(channel.groupmePlugin.outbound?.sendText).toBeTypeOf("function");
    expect(channel.groupmePlugin.outbound?.sendMedia).toBeTypeOf("function");
  });

  it("accepts modern config with OpenClaw secret input references", async () => {
    const { groupmePlugin } = await importBuilt<{
      groupmePlugin: {
        configSchema: {
          runtime: {
            safeParse(input: unknown): { success: boolean; error?: unknown };
          };
        };
        config: {
          resolveAccount(cfg: unknown, accountId?: string): { configured: boolean };
          describeAccount(account: unknown): Record<string, unknown>;
        };
      };
    }>("dist/channel-plugin-api.js");

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
  });

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
  });
});
