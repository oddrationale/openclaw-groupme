export function hasGroupMeConfiguredState(params: { env?: NodeJS.ProcessEnv }): boolean {
  return (
    typeof params.env?.GROUPME_BOT_ID === "string" &&
    params.env.GROUPME_BOT_ID.trim().length > 0
  );
}
