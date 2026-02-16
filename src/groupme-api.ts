import type { GroupMeApiBot, GroupMeApiGroup } from "./types.js";

const GROUPME_API_BASE = "https://api.groupme.com/v3";

function readGroupsResponse(payload: unknown): GroupMeApiGroup[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { response?: unknown }).response)
  ) {
    return [];
  }
  return (payload as { response: GroupMeApiGroup[] }).response;
}

function readBotResponse(payload: unknown): GroupMeApiBot {
  if (
    !payload ||
    typeof payload !== "object" ||
    !(payload as { response?: unknown }).response ||
    typeof (payload as { response: { bot?: unknown } }).response !== "object" ||
    !(payload as { response: { bot?: unknown } }).response.bot
  ) {
    throw new Error("GroupMe bot creation returned an invalid payload");
  }
  return (payload as { response: { bot: GroupMeApiBot } }).response.bot;
}

export async function fetchGroups(accessToken: string): Promise<GroupMeApiGroup[]> {
  const groups: GroupMeApiGroup[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`${GROUPME_API_BASE}/groups`);
    url.searchParams.set("token", accessToken);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("omit", "memberships");
    url.searchParams.set("page", String(page));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GroupMe API error: ${response.status} ${response.statusText}`);
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
}): Promise<GroupMeApiBot> {
  const url = new URL(`${GROUPME_API_BASE}/bots`);
  url.searchParams.set("token", params.accessToken);

  const response = await fetch(url, {
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
    throw new Error(
      `GroupMe bot creation failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  return readBotResponse(payload);
}
