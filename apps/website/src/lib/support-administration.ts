export const supportCapabilities = [
  "FACILITY_READ",
  "STAFF_READ",
  "STAFF_PROVISION",
  "STAFF_SUSPEND",
  "STAFF_RECOVER_ACCESS",
  "OPERATOR_MANAGE",
  "ENROLLMENT_DIAGNOSTICS",
  "ENROLLMENT_RETRY",
  "DELIVERY_DIAGNOSTICS",
  "COMMAND_CENTER_DIAGNOSTICS",
  "INCIDENT_SUPPORT_READ",
  "INCIDENT_RESOLVE",
  "AUDIT_READ",
  "SERVICE_HEALTH_READ",
  "PII_RESOLVE",
  "RESIDENT_SUPPORT_OVERRIDE",
  "FACILITY_ADMIN_DEPROVISION",
] as const;
export const sensitiveCapabilities: readonly string[] = [
  "PII_RESOLVE",
  "INCIDENT_RESOLVE",
  "RESIDENT_SUPPORT_OVERRIDE",
  "FACILITY_ADMIN_DEPROVISION",
  "STAFF_RECOVER_ACCESS",
];
export const globalCapabilities: readonly string[] = [
  "FACILITY_READ",
  "SERVICE_HEALTH_READ",
];
export type SupportGrant = {
  id: string;
  capability: string;
  facilityId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  approvedByUserId: string;
  reason: string;
  createdAt: string;
};
export type SupportEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  facilityId: null;
  isActive: boolean;
  accountStatus: string;
  supportEmployment: {
    state: "ACTIVE" | "SUSPENDED" | "ENDED";
    appointedByUserId: string;
    updatedAt: string;
  } | null;
  supportGrants: SupportGrant[];
  grantsTruncated: boolean;
};
export type SupportDelivery = {
  channel: string;
  status: string;
  deliveryStatus: string;
  attemptCount: number;
  failureCategory: string | null;
  providerAcceptedAt: string | null;
  confirmedDeliveredAt: string | null;
};
export function deliveryLabel(delivery: SupportDelivery): string {
  if (delivery.deliveryStatus === "DELIVERED" && delivery.confirmedDeliveredAt)
    return "Delivery confirmed";
  if (delivery.deliveryStatus === "PROVIDER_ACCEPTED")
    return "Provider accepted; delivery not confirmed";
  if (delivery.deliveryStatus === "FAILED") return "Failed";
  if (delivery.deliveryStatus === "QUEUED") return "Queued";
  if (delivery.deliveryStatus === "ATTEMPTING") return "Attempting";
  if (delivery.status === "CANCELLED") return "Cancelled";
  return "Unknown; delivery not confirmed";
}
export type SupportDirectory = {
  actor?: { id: string; role: string };
  employees: SupportEmployee[];
  invitations: {
    id: string;
    expiresAt: string;
    deliveries?: SupportDelivery[];
    verifiedAt: string | null;
    revokedAt: string | null;
  }[];
  facilities: { id: string; name: string; isActive: boolean }[];
  serverTime: string;
  truncated: boolean;
};
const allowed = new Set([
  "accounts", "nextCursor", "displayIdentity", "membershipState", "facility",
  "sms",
  "email",
  "provider",
  "credentialValidity",
  "actor",
  "receipt",
  "action",
  "resourceId",
  "correlationId",
  "deliveries",
  "channel",
  "deliveryStatus",
  "attemptCount",
  "failureCategory",
  "providerAcceptedAt",
  "confirmedDeliveredAt",
  "employees",
  "invitations",
  "facilities",
  "serverTime",
  "truncated",
  "id",
  "firstName",
  "lastName",
  "role",
  "facilityId",
  "isActive",
  "accountStatus",
  "supportEmployment",
  "state",
  "appointedByUserId",
  "createdAt",
  "updatedAt",
  "supportGrants",
  "grantsTruncated",
  "capability",
  "expiresAt",
  "revokedAt",
  "approvedByUserId",
  "reason",
  "name",
  "verifiedAt",
  "requestId",
  "status",
  "revoked",
]);
export function supportProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(supportProjection);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, entry]) =>
            allowed.has(key) &&
            ((key !== "email" && key !== "sms") ||
              Boolean(
                entry && typeof entry === "object" && !Array.isArray(entry),
              )),
        )
        .map(([key, v]) => [
          key,
          supportProjection(
            key === "email" || key === "sms"
              ? Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).filter(
                    ([field]) =>
                      ["state", "provider", "credentialValidity"].includes(
                        field,
                      ),
                  ),
                )
              : v,
          ),
        ]),
    );
  return value;
}
