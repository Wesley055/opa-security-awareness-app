const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export function institutionalPath(path: string, method: string) {
  if (
    method === "GET" &&
    new RegExp(
      "^(context|facilities|health|readiness|operations/" +
        uuid +
        "|facilities/" +
        uuid +
        "/(first-facility-admin|invitation-roles|members|enrollments|delivery|audit|incidents|command-center|cases|commissioning|oversight))$",
    ).test(path)
  )
    return "/institutional/" + path;
  if (
    method === "POST" &&
    new RegExp(
      "^facilities/" +
        uuid +
        "/(cases|commissioning/evidence|response-policy|lifecycle|cases/" +
        uuid +
        "/state|first-facility-admin|invitations|members/" +
        uuid +
        "/access|invitations/" +
        uuid +
        "/action)$",
    ).test(path)
  )
    return "/institutional/" + path;
  if (
    method === "POST" &&
    new RegExp(
      "^incidents/" + uuid + "/(operations|institutional-resolution)$",
    ).test(path)
  )
    return "/" + path;
  if (
    method === "POST" &&
    new RegExp(
      "^admin/(accounts/" +
        uuid +
        "/recover|invitations|employees/" +
        uuid +
        "/(employment|grants)|grants/" +
        uuid +
        "/revoke|facilities/" +
        uuid +
        "/state)$",
    ).test(path)
  )
    return "/admin/support/" + path.slice(6);
  return null;
}
const fields = new Set([
  "eligible", "enrollmentId",
  "displayIdentity", "roles", "explanation",
  "elevations",
  "startsAt",
  "policyState",
  "policy",
  "acknowledgementSeconds",
  "dispatchSeconds",
  "progressSeconds",
  "unattendedSeconds",
  "closureSeconds",
  "version",
  "incidents",
  "currentExceptions",
  "events",
  "type",
  "occurredAt",
  "kind",
  "interpretation",
  "escalationChannel",
  "receipt",
  "operationalState",
  "organizationId",
  "organization",
  "supportAssignments",
  "assignedByUserId",
  "assignedToUserId",
  "reportedByUserId",
  "sequence",
  "reference",
  "category",
  "summary",
  "priority",
  "updatedAt",
  "facility",
  "evidence",
  "gate",
  "gates",
  "trainingGates",
  "readiness",
  "ready",
  "missing",
  "activeAdmin",
  "passed",
  "recordedByUserId",
  "facilityAdminUserId",
  "supportCaseId",
  "sms",
  "email",
  "provider",
  "credentialValidity",
  "actor",
  "id",
  "role",
  "facilities",
  "name",
  "capabilities",
  "globalCapabilities",
  "isActive",
  "membershipState",
  "accountStatus",
  "requestedRole",
  "verifiedAt",
  "acceptedAt",
  "revokedAt",
  "expiresAt",
  "status",
  "trigger",
  "createdAt",
  "resolvedAt",
  "channel",
  "deliveryStatus",
  "failureCategory",
  "attemptCount",
  "providerAcceptedAt",
  "actorUserId",
  "action",
  "resourceId",
  "authorityKind",
  "authorityGrantId",
  "correlationId",
  "caseReference",
  "requestId",
  "credentialsRevoked",
  "eventId",
  "state",
  "capability",
  "facilityId",
  "openIncidents",
  "activeOperators",
  "database",
  "delivery",
  "revoked",
]);
export function institutionalProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(institutionalProjection);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, entry]) =>
            fields.has(key) &&
            ((key !== "email" && key !== "sms") ||
              Boolean(
                entry && typeof entry === "object" && !Array.isArray(entry),
              )),
        )
        .map(([key, v]) => [
          key,
          institutionalProjection(
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
