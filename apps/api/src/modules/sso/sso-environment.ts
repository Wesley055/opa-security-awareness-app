import {
  classify,
  hash,
  readPolicy,
} from "../../../../../packages/environment-policy/index.cjs";
import { SsoDenied } from "./sso.policy";
export function assertSsoEnabled(): void {
  const e = classify(process.env);
  if (
    (e === "staging" && process.env.OPA_SSO_ENABLED !== "true") ||
    process.env.OPA_SSO_ENABLED === "false"
  )
    throw new SsoDenied();
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function assertSsoBinding(
  input: {
    providerType: string;
    issuer: string;
    audience: string;
    trust: unknown;
  },
  secret?: string,
): void {
  assertSsoEnabled();
  const e = classify(process.env);
  if (e === "development") return;
  try {
    const p = readPolicy(process.env.OPA_ENVIRONMENT_POLICY_FILE, e, "api");
    const allowed = p.ssoBindings as Array<{
      providerType: string;
      issuer: string;
      audience: string;
      trustSha256: string;
      callbackUrl: string;
      clientSecretSha256?: string;
    }>;
    if (
      !allowed.some(
        (b) =>
          b.providerType === input.providerType &&
          b.issuer === input.issuer &&
          b.audience === input.audience &&
          b.callbackUrl === process.env.SSO_WEB_ORIGIN + "/api/sso/callback" &&
          b.trustSha256 === hash(stable(input.trust)) &&
          b.clientSecretSha256 === (secret ? hash(secret) : undefined),
      )
    )
      throw new SsoDenied();
  } catch {
    throw new SsoDenied();
  }
}
