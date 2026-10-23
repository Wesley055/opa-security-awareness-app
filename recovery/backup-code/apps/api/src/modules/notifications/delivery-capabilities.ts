/** Transport capability uses the existing provider configuration; no new channel switch. */
export function deliveryChannelEnabled(channel: string, env = process.env): boolean {
  if (env.OPA_NOTIFICATION_MODE && !["live", "allowlist"].includes(env.OPA_NOTIFICATION_MODE)) return false;
  // Preserve opted-in SMS intent even if credentials fail: never silently drop a required SMS.
  if (channel === "SMS") return true;
  if (channel === "EMAIL") return emailTransportConfigured(env);
  // These adapters are explicit non-sending stubs in this delivery contract.
  return false;
}
export function emailTransportConfigured(env = process.env): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_ADDRESS);
}
