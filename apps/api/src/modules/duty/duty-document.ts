import { createHash } from "node:crypto";
import { FacilityType } from "@prisma/client";

/**
 * OPA Duty Reports: the prepared summary of one shift.
 *
 * Rules (design docs/design/2026-10-19-duty-reports-and-staff-profiles.md):
 * - References only. Incidents are listed by id with their state at the
 *   cutoff; nothing here can change an incident or its evidence.
 * - Each incident appears ONCE: raised during the shift, or carried over
 *   (raised before the shift and still open at its start). The buckets are
 *   disjoint by construction.
 * - "acknowledged" is true only for a Command Center acknowledgement by an
 *   identified operator (same definition as OPA Insight). Otherwise the
 *   report says "not acknowledged or unknown"; it never infers one.
 */
export const DUTY_DOCUMENT_SCHEMA = 1;

export type DutyIncidentRef = {
  id: string;
  reference: string;
  trigger: string;
  status: string;
  raisedAt: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

export type DutySection =
  | { key: "visitors"; entries: number; exits: number; denied: number; overstays: number; manualEntries: number }
  | { key: "safewalk"; started: number; emergencies: number };

export type DutyDocument = {
  schema: number;
  facilityType: FacilityType;
  membersLabel: string;
  window: { from: string; to: string };
  incidents: { raised: DutyIncidentRef[]; carriedOver: DutyIncidentRef[] };
  totals: { raised: number; carriedOver: number; acknowledged: number; notAcknowledgedOrUnknown: number; stillOpenAtCutoff: number };
  sections: DutySection[];
  verifiedSources: string[];
};

const MEMBERS: Partial<Record<FacilityType, string>> = {
  ESTATE: "residents",
  SCHOOL: "students and staff",
  BANK: "customers and staff",
  ORGANIZATION: "staff",
};
export function membersLabel(type: FacilityType): string {
  return MEMBERS[type] ?? "members";
}

export function incidentReference(id: string): string {
  return "INC-" + id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

type RawIncident = { id: string; trigger: string; status: string; createdAt: Date; resolvedAt: Date | null };
type RawAck = { incidentId: string; occurredAt: Date };

export function buildDocument(input: {
  facilityType: FacilityType;
  from: Date;
  to: Date;
  incidents: RawIncident[];
  acknowledgements: RawAck[];
  sections: DutySection[];
}): DutyDocument {
  const firstAck = new Map<string, Date>();
  for (const a of input.acknowledgements) {
    const prev = firstAck.get(a.incidentId);
    if (!prev || a.occurredAt < prev) firstAck.set(a.incidentId, a.occurredAt);
  }
  const seen = new Set<string>();
  const raised: DutyIncidentRef[] = [];
  const carriedOver: DutyIncidentRef[] = [];
  const sorted = [...input.incidents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  for (const i of sorted) {
    if (seen.has(i.id)) continue; // never count an incident twice
    seen.add(i.id);
    const ack = firstAck.get(i.id) ?? null;
    const validAck = ack && ack >= i.createdAt && ack <= input.to && (!i.resolvedAt || ack <= i.resolvedAt) ? ack : null;
    const ref: DutyIncidentRef = {
      id: i.id,
      reference: incidentReference(i.id),
      trigger: i.trigger,
      status: i.status,
      raisedAt: i.createdAt.toISOString(),
      acknowledged: validAck !== null,
      acknowledgedAt: validAck ? validAck.toISOString() : null,
      resolvedAt: i.resolvedAt && i.resolvedAt <= input.to ? i.resolvedAt.toISOString() : null,
    };
    (i.createdAt >= input.from ? raised : carriedOver).push(ref);
  }
  const all = [...raised, ...carriedOver];
  const acknowledged = all.filter((r) => r.acknowledged).length;
  return {
    schema: DUTY_DOCUMENT_SCHEMA,
    facilityType: input.facilityType,
    membersLabel: membersLabel(input.facilityType),
    window: { from: input.from.toISOString(), to: input.to.toISOString() },
    incidents: { raised, carriedOver },
    totals: {
      raised: raised.length,
      carriedOver: carriedOver.length,
      acknowledged,
      notAcknowledgedOrUnknown: all.length - acknowledged,
      stillOpenAtCutoff: all.filter((r) => r.resolvedAt === null).length,
    },
    sections: input.sections,
    verifiedSources: ["incidents", "incident-timeline", ...input.sections.map((s) => s.key)],
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value as object).sort().map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
export function documentDigest(doc: DutyDocument): string {
  return createHash("sha256").update(canonical(doc)).digest("hex");
}

export type HandoverItem = { text: string; category: "HANDOVER" | "UNRESOLVED" | "OBSERVATION" };
