import { PrismaClient } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { NotificationResponse } from "./providers/notification-provider.interface";
import {
  classify,
  preflight,
} from "../../../../../packages/environment-policy/index.cjs";
export function normalizedRecipient(
  channel: string,
  recipient: string,
): string | null {
  if (channel === "SMS") {
    const p = parsePhoneNumberFromString(recipient);
    return p?.isValid() && recipient === p.number ? p.number : null;
  }
  if (channel === "EMAIL")
    return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)
      ? recipient.toLowerCase()
      : null;
  if (channel === "PUSH")
    return /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(recipient)
      ? recipient
      : null;
  return null;
}
export function recipientAllowed(
  channel: string,
  recipient: string,
  env = process.env,
): boolean {
  if (env.OPA_NOTIFICATION_MODE !== "allowlist") return false;
  try {
    const list = JSON.parse(
      env.OPA_NOTIFICATION_ALLOWLIST_JSON || "{}",
    ) as Record<string, unknown>;
    const n = normalizedRecipient(channel, recipient);
    return (
      n !== null &&
      Array.isArray(list[channel]) &&
      list[channel].some(
        (v: unknown) =>
          typeof v === "string" && normalizedRecipient(channel, v) === n,
      )
    );
  } catch {
    return false;
  }
}
let client: PrismaClient | undefined;
export async function reserveBudget(database?: PrismaClient): Promise<boolean> {
  const db = database ?? (client ??= new PrismaClient());
  const run = process.env.OPA_ACCEPTANCE_RUN_ID!;
  const hour = Math.floor(Date.now() / 3_600_000);
  const limits = [
    [`staging:hour:${hour}`, Number(process.env.OPA_NOTIFICATION_MAX_PER_HOUR)],
    [`staging:run:${run}`, Number(process.env.OPA_NOTIFICATION_MAX_PER_RUN)],
  ] as const;
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(run) ||
    limits.some(
      ([, limit]) => !Number.isInteger(limit) || limit < 1 || limit > 999,
    )
  )
    return false;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('opa:staging:notification-budget'))`;
    for (const [key, limit] of limits) {
      const row = await tx.stagingNotificationBudget.findUnique({
        where: { key },
      });
      if ((row?.count ?? 0) >= limit) return false;
    }
    for (const [key] of limits)
      await tx.stagingNotificationBudget.upsert({
        where: { key },
        create: { key, count: 1 },
        update: { count: { increment: 1 } },
      });
    return true;
  });
}
export async function outboundDenial(
  channel: string,
  recipient: string,
  reserve = reserveBudget,
  check = preflight,
): Promise<NotificationResponse | null> {
  let classification: string = "invalid";
  try {
    const environment = classify(process.env);
    classification = environment;
    if (
      environment === "development" ||
      (environment === "production" &&
        (!process.env.OPA_NOTIFICATION_MODE ||
          process.env.OPA_NOTIFICATION_MODE === "live"))
    )
      return null;
    // Revalidate at transport boundary: no call site or retry can bypass isolation.
    check(process.env);
    if (recipientAllowed(channel, recipient) && (await reserve())) return null;
  } catch {
    /* Deny on malformed policy or unavailable quota store. */
  }
  console.warn(
    "[OPA-NOTIFICATION]",
    JSON.stringify({ environment: classification, policy: "denied", channel }),
  );
  return {
    success: false,
    provider: channel,
    failureCategory: "REJECTED",
    retryable: false,
    error: "Environment notification policy denied send",
  };
}
