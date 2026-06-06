export function normalizeStringId(raw: unknown): string | undefined {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return undefined;
  }
  if (typeof raw === "number" && !Number.isFinite(raw)) {
    return undefined;
  }
  const normalized = String(raw).trim();
  return normalized || undefined;
}

const TARGET_PREFIX_RE = /^(groupme:)?(user:|group:)?/i;

export function normalizeGroupMeTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const stripped = trimmed.replace(TARGET_PREFIX_RE, "").trim();
  return stripped || undefined;
}

export function normalizeGroupMeAllowEntry(raw: string): string | undefined {
  const normalized = normalizeGroupMeTarget(raw);
  if (!normalized) {
    return undefined;
  }
  return normalized.toLowerCase() === "*" ? "*" : normalized;
}

export function looksLikeGroupMeTargetId(raw: string): boolean {
  const normalized = normalizeGroupMeTarget(raw);
  if (!normalized) {
    return false;
  }
  if (normalized === "*") {
    return false;
  }
  return !/\s/.test(normalized);
}
