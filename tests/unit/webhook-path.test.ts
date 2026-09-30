import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUPME_WEBHOOK_PATH,
  normalizeWebhookPath,
  parseWebhookSetupInput,
} from "../../src/webhook-path.js";

describe("normalizeWebhookPath", () => {
  it("defaults missing or blank paths to /groupme", () => {
    expect(DEFAULT_GROUPME_WEBHOOK_PATH).toBe("/groupme");
    expect(normalizeWebhookPath(undefined)).toBe("/groupme");
    expect(normalizeWebhookPath("   ")).toBe("/groupme");
  });

  it("keeps only the path of relative paths and full URLs", () => {
    expect(normalizeWebhookPath(" /hooks/gm ")).toBe("/hooks/gm");
    expect(normalizeWebhookPath("hooks/gm")).toBe("/hooks/gm");
    expect(normalizeWebhookPath("/hooks/gm?k=secret#frag")).toBe("/hooks/gm");
    expect(normalizeWebhookPath("https://bot.example.com/hooks/gm?k=secret")).toBe("/hooks/gm");
    expect(normalizeWebhookPath("https://bot.example.com")).toBe("/");
  });

  it("falls back to a route-shaped path for unparseable input", () => {
    expect(normalizeWebhookPath("http://%")).toBe("/http://%");
    // Protocol-relative input with an invalid host: already rooted, query dropped.
    expect(normalizeWebhookPath("//%?k=secret")).toBe("//%");
  });
});

describe("parseWebhookSetupInput", () => {
  it("splits the callback token out of a full GroupMe callback URL", () => {
    expect(parseWebhookSetupInput(" https://bot.example.com/groupme?k=abc#x ")).toEqual({
      webhookPath: "/groupme",
      callbackToken: "abc",
    });
  });

  it("accepts bare paths with or without a token", () => {
    expect(parseWebhookSetupInput("/gm")).toEqual({ webhookPath: "/gm", callbackToken: undefined });
    expect(parseWebhookSetupInput("/gm?k=%20")).toEqual({
      webhookPath: "/gm",
      callbackToken: undefined,
    });
    expect(parseWebhookSetupInput("/gm?other=1&k=t")).toEqual({
      webhookPath: "/gm",
      callbackToken: "t",
    });
  });

  it("degrades to normalizeWebhookPath when the URL cannot be parsed", () => {
    expect(parseWebhookSetupInput("http://%")).toEqual({ webhookPath: "/http://%" });
  });
});
