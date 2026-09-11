export type DeliveryStatus =
  | "QUEUED"
  | "ATTEMPTING"
  | "PROVIDER_ACCEPTED"
  | "DELIVERED"
  | "FAILED"
  | "UNKNOWN";
export type DeliveryAttempt = {
  id: string;
  channel: "SMS" | "EMAIL" | "PUSH" | "WHATSAPP" | "VOICE";
  recipient: { maskedIdentity: string; reference: string };
  status: DeliveryStatus;
  receiptAuthentication: "PROVIDER_SIGNATURE" | "UNAVAILABLE";
  queuedAt: string;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  providerAcceptedAt: string | null;
  deliveredAt: string | null;
  failureCategory: string | null;
  attemptCount: number;
  retryCount: number;
  retryScheduledAt: string | null;
  hasUnconfirmedOutcome: boolean;
  historyComplete: boolean;
};
export type DeliveryPage = {
  version: 1;
  items: DeliveryAttempt[];
  nextCursor: string | null;
};
export type DeliverySnapshot =
  { state: "READY"; page: DeliveryPage } | { state: "BACKEND_BLOCKED" };

const statuses = [
  "QUEUED",
  "ATTEMPTING",
  "PROVIDER_ACCEPTED",
  "DELIVERED",
  "FAILED",
  "UNKNOWN",
];
const failures = [
  "AUTHENTICATION",
  "INVALID_RECIPIENT",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "NETWORK",
  "TIMEOUT",
  "REJECTED",
  "EXPIRED",
  "UNKNOWN_PROVIDER_ERROR",
  "INTERNAL_ERROR",
];
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown) =>
  v === null ||
  (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)));
/** Whitelist upstream fields; provider IDs, secrets and raw payloads never cross the bridge. */
export function deliveryPage(value: unknown): DeliveryPage | null {
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        /^[0-9a-f-]{36}$/i.test(value.nextCursor))
    )
  )
    return null;
  const items: DeliveryAttempt[] = [];
  for (const row of value.items) {
    if (
      !object(row) ||
      typeof row.id !== "string" ||
      !object(row.recipient) ||
      typeof row.recipient.maskedIdentity !== "string" ||
      !["SMS", "EMAIL", "PUSH", "WHATSAPP", "VOICE"].includes(
        String(row.channel),
      ) ||
      !statuses.includes(String(row.status)) ||
      !["PROVIDER_SIGNATURE", "UNAVAILABLE"].includes(
        String(row.receiptAuthentication),
      ) ||
      ![
        row.queuedAt,
        row.firstAttemptAt,
        row.lastAttemptAt,
        row.providerAcceptedAt,
        row.deliveredAt,
        row.retryScheduledAt,
      ].every(date) ||
      typeof row.queuedAt !== "string" ||
      !Number.isSafeInteger(row.attemptCount) ||
      !Number.isSafeInteger(row.retryCount) ||
      Number(row.attemptCount) < 0 ||
      Number(row.retryCount) < 0 ||
      !(
        row.failureCategory === null ||
        failures.includes(String(row.failureCategory))
      ) ||
      typeof row.historyComplete !== "boolean" ||
      typeof row.hasUnconfirmedOutcome !== "boolean"
    )
      return null;
    // Only the server's presentation alphabet is accepted, never a full address/token.
    const masked = row.recipient.maskedIdentity;
    if (!/^(?:••••(?:\d{4})?|[^\s@]••••@••••)$/.test(masked)) return null;
    items.push({
      id: row.id.slice(0, 128),
      recipient: { maskedIdentity: masked, reference: row.id.slice(0, 128) },
      channel: row.channel as DeliveryAttempt["channel"],
      status: row.status as DeliveryStatus,
      receiptAuthentication:
        row.receiptAuthentication as DeliveryAttempt["receiptAuthentication"],
      queuedAt: row.queuedAt,
      firstAttemptAt: row.firstAttemptAt as string | null,
      lastAttemptAt: row.lastAttemptAt as string | null,
      providerAcceptedAt: row.providerAcceptedAt as string | null,
      deliveredAt: row.deliveredAt as string | null,
      failureCategory: row.failureCategory as string | null,
      attemptCount: Number(row.attemptCount),
      retryCount: Number(row.retryCount),
      retryScheduledAt: row.retryScheduledAt as string | null,
      hasUnconfirmedOutcome: row.hasUnconfirmedOutcome,
      historyComplete: row.historyComplete,
    });
  }
  return { version: 1, items, nextCursor: value.nextCursor as string | null };
}
