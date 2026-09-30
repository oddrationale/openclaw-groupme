export const DEFAULT_GROUPME_WEBHOOK_PATH = "/groupme";

export function normalizeWebhookPath(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return DEFAULT_GROUPME_WEBHOOK_PATH;
  }
  try {
    const parsed = new URL(trimmed, "http://localhost");
    return parsed.pathname || DEFAULT_GROUPME_WEBHOOK_PATH;
  } catch {
    // Unparseable input (e.g. "http://%"): strip any query/fragment and ensure a
    // leading slash so we still return a route-shaped path rather than throwing.
    // This is a display/registration fallback for malformed config, not a parser.
    // The `?? trimmed` and empty-`noQuery` guards are defensive: split() always yields
    // a [0], and a non-empty trimmed string can't reduce to an empty noQuery here.
    /* v8 ignore start */
    const noQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
    if (!noQuery) {
      return DEFAULT_GROUPME_WEBHOOK_PATH;
    }
    /* v8 ignore stop */
    return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  }
}

/**
 * Accepts either a bare path or a full callback URL (as shown in the GroupMe bot
 * settings) and splits out the `?k=` callback token when present.
 */
export function parseWebhookSetupInput(raw: string): {
  webhookPath: string;
  callbackToken?: string;
} {
  try {
    const parsed = new URL(raw.trim(), "http://localhost");
    const callbackToken = parsed.searchParams.get("k")?.trim() || undefined;
    return {
      webhookPath: parsed.pathname || DEFAULT_GROUPME_WEBHOOK_PATH,
      callbackToken,
    };
  } catch {
    return {
      webhookPath: normalizeWebhookPath(raw),
    };
  }
}
