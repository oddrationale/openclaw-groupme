import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type {
  CoreConfig,
  GroupMeAccountConfig,
  GroupMeConfig,
  ResolvedGroupMeAccount,
} from "./types.js";

export function readTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function hasSecretInput(value: unknown): boolean {
  if (typeof value === "string") {
    return Boolean(value.trim());
  }
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function trimSecretInput(value: GroupMeAccountConfig["botId"]): GroupMeAccountConfig["botId"] {
  return typeof value === "string" ? readTrimmed(value) : value;
}

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.groupme?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }

  const ids = new Set<string>();
  for (const key of Object.keys(accounts)) {
    const normalized = normalizeAccountId(key);
    if (normalized) {
      ids.add(normalized);
    }
  }

  return [...ids];
}

function resolveAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): GroupMeAccountConfig | undefined {
  const accounts = cfg.channels?.groupme?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }

  if (Object.hasOwn(accounts, accountId)) {
    return accounts[accountId];
  }

  const hit = Object.keys(accounts).find((key) => normalizeAccountId(key) === accountId);
  return hit ? accounts[hit] : undefined;
}

function mergeAccountConfig(cfg: CoreConfig, accountId: string): GroupMeAccountConfig {
  const raw = (cfg.channels?.groupme ?? {}) as GroupMeConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account =
    accountId === DEFAULT_ACCOUNT_ID ? {} : (resolveAccountConfig(cfg, accountId) ?? {});

  return {
    ...base,
    ...account,
  };
}

export function listGroupMeAccountIds(cfg: CoreConfig): string[] {
  const sorted = listConfiguredAccountIds(cfg).toSorted((a, b) => a.localeCompare(b));
  return [DEFAULT_ACCOUNT_ID, ...sorted.filter((id) => id !== DEFAULT_ACCOUNT_ID)];
}

export function resolveDefaultGroupMeAccountId(cfg: CoreConfig): string {
  const configuredDefault = readTrimmed(cfg.channels?.groupme?.defaultAccount);
  if (configuredDefault) {
    return normalizeAccountId(configuredDefault);
  }

  return DEFAULT_ACCOUNT_ID;
}

export function resolveGroupMeAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedGroupMeAccount {
  const normalizedRequested = normalizeAccountId(params.accountId);
  const accountId =
    normalizedRequested || resolveDefaultGroupMeAccountId(params.cfg) || DEFAULT_ACCOUNT_ID;

  const merged = mergeAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.groupme?.enabled !== false;
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const botId = readTrimmed(merged.botId) ?? "";
  const accessToken = readTrimmed(merged.accessToken) ?? "";
  const botName = readTrimmed(merged.botName);
  const groupId = readTrimmed(merged.groupId);
  const webhookPath = readTrimmed(merged.webhookPath);
  const publicDomain = readTrimmed(merged.publicDomain);

  const config: GroupMeAccountConfig = {
    ...merged,
    botId: trimSecretInput(merged.botId),
    accessToken: trimSecretInput(merged.accessToken),
    callbackToken: trimSecretInput(merged.callbackToken),
    botName,
    groupId,
    publicDomain,
    webhookPath,
  };

  return {
    accountId,
    name: readTrimmed(merged.name),
    enabled,
    configured: hasSecretInput(merged.botId),
    botId,
    accessToken,
    config,
  };
}
