/** Operational readiness is distinct from the last-admin commissionedAt guard. */
export const COMMISSIONING_GATES = [
  "CONFIGURATION",
  "SMS",
  "EMAIL",
  "FACILITY_ADMIN",
  "COMMAND_CENTER",
  "OPERATOR",
  "RESIDENT",
  "PHYSICAL_SOS",
] as const;
export const TRAINING_GATES = [
  "TRAINING_WORKSPACE",
  "TRAINING_OPERATOR_MANAGEMENT",
  "TRAINING_RESIDENT_ONBOARDING",
  "TRAINING_INCIDENT_LIFECYCLE",
  "TRAINING_OPERATOR_OVERSIGHT",
  "TRAINING_ESCALATION",
  "TRAINING_SUPPORT",
  "TRAINING_PHYSICAL_ACCEPTANCE",
] as const;
export const STANDARD_SUPPORT_PERMISSIONS = [
  "STAFF_READ",
  "STAFF_PROVISION",
  "ENROLLMENT_DIAGNOSTICS",
  "ENROLLMENT_RETRY",
  "DELIVERY_DIAGNOSTICS",
  "COMMAND_CENTER_DIAGNOSTICS",
  "AUDIT_READ",
] as const;
export function commissioningReadiness(
  evidence: Array<{ gate: string; passed: boolean }>,
  prerequisites: { organization: boolean; activeAdmin: boolean },
) {
  // Caller supplies newest-first evidence. Failed rechecks supersede past passes.
  const latest = new Map<string, boolean>();
  for (const row of evidence)
    if (!latest.has(row.gate)) latest.set(row.gate, row.passed);
  const missing = COMMISSIONING_GATES.filter(
    (gate) => latest.get(gate) !== true,
  );
  return {
    ready:
      prerequisites.organization &&
      prerequisites.activeAdmin &&
      missing.length === 0,
    missing,
    ...prerequisites,
  };
}
