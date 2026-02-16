import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "openclaw/plugin-sdk/account-id";
import type {
  CoreConfig,
  GroupMeAccountConfig,
  GroupMeConfig,
  ResolvedGroupMeAccount,
} from "./types.js";

const ENV_BOT_ID = "GROUPME_BOT_ID";
const ENV_ACCESS_TOKEN = "GROUPME_ACCESS_TOKEN";
const ENV_BOT_NAME = "GROUPME_BOT_NAME";
const ENV_CALLBACK_URL = "GROUPME_CALLBACK_URL";
const ENV_GROUP_ID = "GROUPME_GROUP_ID";
const ENV_PUBLIC_DOMAIN = "GROUPME_PUBLIC_DOMAIN";

export function readTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
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

  const hit = Object.keys(accounts).find(
    (key) => normalizeAccountId(key) === accountId,
  );
  return hit ? accounts[hit] : undefined;
}

function mergeAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): GroupMeAccountConfig {
  const raw = (cfg.channels?.groupme ?? {}) as GroupMeConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account =
    accountId === DEFAULT_ACCOUNT_ID
      ? {}
      : (resolveAccountConfig(cfg, accountId) ?? {});

  return {
    ...base,
    ...account,
  };
}

export function listGroupMeAccountIds(cfg: CoreConfig): string[] {
  const ids = new Set<string>([DEFAULT_ACCOUNT_ID]);
  for (const id of listConfiguredAccountIds(cfg)) {
    ids.add(id);
  }

  const ordered = [...ids].toSorted((a, b) => a.localeCompare(b));
  if (ordered[0] !== DEFAULT_ACCOUNT_ID) {
    ordered.unshift(DEFAULT_ACCOUNT_ID);
    return Array.from(new Set(ordered));
  }
  return ordered;
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
    normalizedRequested ||
    resolveDefaultGroupMeAccountId(params.cfg) ||
    DEFAULT_ACCOUNT_ID;

  const merged = mergeAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.groupme?.enabled !== false;
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const isDefaultAccount = accountId === DEFAULT_ACCOUNT_ID;
  const botId =
    readTrimmed(merged.botId) ||
    (isDefaultAccount ? readTrimmed(process.env[ENV_BOT_ID]) : undefined) ||
    "";
  const accessToken =
    readTrimmed(merged.accessToken) ||
    (isDefaultAccount
      ? readTrimmed(process.env[ENV_ACCESS_TOKEN])
      : undefined) ||
    "";
  const botName =
    readTrimmed(merged.botName) ||
    (isDefaultAccount ? readTrimmed(process.env[ENV_BOT_NAME]) : undefined) ||
    undefined;
  const groupId =
    readTrimmed(merged.groupId) ||
    (isDefaultAccount
      ? readTrimmed(process.env[ENV_GROUP_ID])
      : undefined) ||
    undefined;
  const callbackUrl =
    readTrimmed(merged.callbackUrl) ||
    (isDefaultAccount
      ? readTrimmed(process.env[ENV_CALLBACK_URL])
      : undefined) ||
    undefined;
  const publicDomain =
    readTrimmed(merged.publicDomain) ||
    (isDefaultAccount
      ? readTrimmed(process.env[ENV_PUBLIC_DOMAIN])
      : undefined) ||
    undefined;

  const config: GroupMeAccountConfig = {
    ...merged,
    botId,
    accessToken,
    botName,
    groupId,
    publicDomain,
    callbackUrl,
  };

  return {
    accountId,
    name: readTrimmed(merged.name),
    enabled,
    configured: Boolean(botId),
    botId,
    accessToken,
    config,
  };
}
