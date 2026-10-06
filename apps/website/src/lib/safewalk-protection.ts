export type SafeWalkEmergency = {
  id: string;
  status: string;
  emergencyStartedAt: string;
  acknowledged: boolean;
  lastOperationalEvent: string | null;
  lastFixReceivedAt: string | null;
  trackingState: string;
};
export type SafeWalkProtectionData = {
  facilityId: string;
  serverTime: string;
  hasMore: boolean;
  incidents: SafeWalkEmergency[];
};
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const date = (v: unknown): string => {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
    throw Error("Invalid emergency timestamp");
  return v;
};
const choice = (v: unknown, allowed: string[]): string => {
  if (typeof v !== "string" || !allowed.includes(v))
    throw Error("Invalid emergency state");
  return v;
};
export function parseSafeWalkProtection(
  value: unknown,
  facilityId?: string,
): SafeWalkProtectionData {
  const data = record(value);
  if (
    !isUuid(data.facilityId) ||
    (facilityId && data.facilityId !== facilityId) ||
    !Array.isArray(data.incidents) ||
    data.incidents.length > 100 ||
    typeof data.hasMore !== "boolean"
  )
    throw Error("Invalid emergency response");
  return {
    facilityId: data.facilityId,
    serverTime: date(data.serverTime),
    hasMore: data.hasMore,
    incidents: data.incidents.map((value) => {
      const row = record(value);
      if (!isUuid(row.id) || typeof row.acknowledged !== "boolean")
        throw Error("Invalid emergency record");
      return {
        id: row.id,
        status: choice(row.status, [
          "OPEN",
          "ACKNOWLEDGED",
          "RESOLVED",
          "CANCELLED",
        ]),
        emergencyStartedAt: date(row.emergencyStartedAt),
        acknowledged: row.acknowledged,
        lastOperationalEvent:
          row.lastOperationalEvent === null
            ? null
            : choice(row.lastOperationalEvent, [
                "OPERATOR_SEEN",
                "OPERATOR_ACKNOWLEDGED",
                "OPERATOR_DISPATCHED",
                "OPERATOR_RESPONSE_PROGRESS",
                "OPERATOR_ESCALATION",
              ]),
        lastFixReceivedAt:
          row.lastFixReceivedAt === null ? null : date(row.lastFixReceivedAt),
        trackingState: choice(row.trackingState, [
          "RECEIVING",
          "SILENT",
          "AWAITING_FIRST_FIX",
          "ENDED",
        ]),
      };
    }),
  };
}
