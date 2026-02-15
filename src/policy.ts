import {
  normalizeGroupMeAllowEntry,
  normalizeGroupMeUserId,
} from "./normalize.js";

export function resolveSenderAccess(params: {
  senderId: string;
  allowFrom?: Array<string | number>;
}): boolean {
  const senderId = normalizeGroupMeUserId(params.senderId);
  if (!senderId) {
    return false;
  }

  const allowFrom = params.allowFrom ?? [];
  if (allowFrom.length === 0) {
    return true;
  }

  const normalizedAllow = allowFrom
    .map((entry) => normalizeGroupMeAllowEntry(String(entry)))
    .filter((entry): entry is string => Boolean(entry));

  if (normalizedAllow.includes("*")) {
    return true;
  }

  return normalizedAllow.includes(senderId);
}
