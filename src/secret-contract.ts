import {
  collectSimpleChannelFieldAssignments,
  getChannelSurface,
  type ResolverContext,
  type SecretDefaults,
  type SecretTargetRegistryEntry,
} from "openclaw/plugin-sdk/channel-secret-basic-runtime";

const secretFields = ["botId", "accessToken", "callbackToken"] as const;

export const secretTargetRegistryEntries: SecretTargetRegistryEntry[] = secretFields.flatMap(
  (field) => [
    {
      id: `channels.groupme.accounts.*.${field}`,
      targetType: `channels.groupme.accounts.*.${field}`,
      configFile: "openclaw.json",
      pathPattern: `channels.groupme.accounts.*.${field}`,
      secretShape: "secret_input",
      expectedResolvedValue: "string",
      includeInPlan: true,
      includeInConfigure: true,
      includeInAudit: true,
    },
    {
      id: `channels.groupme.${field}`,
      targetType: `channels.groupme.${field}`,
      configFile: "openclaw.json",
      pathPattern: `channels.groupme.${field}`,
      secretShape: "secret_input",
      expectedResolvedValue: "string",
      includeInPlan: true,
      includeInConfigure: true,
      includeInAudit: true,
    },
  ],
);

export function collectRuntimeConfigAssignments(params: {
  config: { channels?: Record<string, unknown> };
  defaults?: SecretDefaults;
  context: ResolverContext;
}): void {
  const resolved = getChannelSurface(params.config, "groupme");
  if (!resolved) {
    return;
  }

  const { channel, surface } = resolved;
  for (const field of secretFields) {
    collectSimpleChannelFieldAssignments({
      channelKey: "groupme",
      field,
      channel,
      surface,
      defaults: params.defaults,
      context: params.context,
      topInactiveReason: `no enabled account inherits this top-level GroupMe ${field}.`,
      accountInactiveReason: "GroupMe account is disabled.",
    });
  }
}

export const channelSecrets = {
  secretTargetRegistryEntries,
  collectRuntimeConfigAssignments,
};
