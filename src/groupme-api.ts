import type { GroupMeApiBot, GroupMeApiGroup } from "./types.js";

const GROUPME_API_BASE = "https://api.groupme.com/v3";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type GroupMeApiOptions = {
  fetchFn?: FetchLike;
  apiBaseUrl?: string;
};

async function readApiError(response: Response): Promise<string> {
  const fallback = `GroupMe API error: ${response.status} ${response.statusText}`;
  try {
    const payload = (await response.json()) as { meta?: { errors?: unknown } };
    const errors = payload?.meta?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const text = errors
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .join("; ");
      if (text) {
        return `${fallback} (${text})`;
      }
    }
  } catch {
    // Ignore JSON parse errors; fall back to generic status text.
  }
  return fallback;
}

function readGroupsResponse(payload: unknown): GroupMeApiGroup[] {
  const response = (payload as { response?: unknown })?.response;
  if (!Array.isArray(response)) {
    throw new Error("GroupMe groups fetch returned an invalid payload");
  }
  return response as GroupMeApiGroup[];
}

function readBotResponse(payload: unknown): GroupMeApiBot {
  const bot = (payload as { response?: { bot?: unknown } })?.response?.bot;
  if (!bot) {
    throw new Error("GroupMe bot creation returned an invalid payload");
  }
  return bot as GroupMeApiBot;
}

export async function fetchGroups(
  accessToken: string,
  options: GroupMeApiOptions = {},
): Promise<GroupMeApiGroup[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? GROUPME_API_BASE;
  const groups: GroupMeApiGroup[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`${apiBaseUrl}/groups`);
    url.searchParams.set("token", accessToken);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("omit", "memberships");
    url.searchParams.set("page", String(page));

    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const payload = await response.json();
    const pageGroups = readGroupsResponse(payload);
    if (pageGroups.length === 0) {
      break;
    }

    groups.push(...pageGroups);
    page += 1;
  }

  return groups;
}

export async function createBot(params: {
  accessToken: string;
  name: string;
  groupId: string;
  callbackUrl: string;
  fetchFn?: FetchLike;
  apiBaseUrl?: string;
}): Promise<GroupMeApiBot> {
  const fetchFn = params.fetchFn ?? fetch;
  const apiBaseUrl = params.apiBaseUrl ?? GROUPME_API_BASE;
  const url = new URL(`${apiBaseUrl}/bots`);
  url.searchParams.set("token", params.accessToken);

  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bot: {
        name: params.name,
        group_id: params.groupId,
        callback_url: params.callbackUrl,
        active: true,
      },
    }),
  });
  if (!response.ok) {
    const apiError = await readApiError(response);
    throw new Error(`GroupMe bot creation failed: ${apiError}`);
  }

  const payload = await response.json();
  return readBotResponse(payload);
}
