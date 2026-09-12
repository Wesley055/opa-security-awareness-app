import { ActivationMode, ActivationSource } from '../emergency-detection/dto/trigger-request.dto';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';

export const SCHEMA_VERSION = 1;
export const GENERATOR_VERSION = 'opa-evidence-1.0.0';
export const SOURCE_SELECT = {
  id: true, facilityId: true, trigger: true, status: true, createdAt: true,
  updatedAt: true, resolvedAt: true, latitude: true, longitude: true,
  timelineEvents: { orderBy: { sequence: 'asc' as const }, take: 10001,
    select: { id: true, sequence: true, type: true, source: true, actorUserId: true,
      payload: true, occurredAt: true, recordedAt: true } },
  notifications: { orderBy: { id: 'asc' as const }, take: 10001,
    select: { id: true, channel: true, deliveryStatus: true, queuedAt: true,
      _count: { select: { deliveryEvents: { where: { reason: 'DURABLY_QUEUED' } } } },
      providerAcceptedAt: true, confirmedDeliveredAt: true, acknowledgedAt: true,
      attemptCount: true, updatedAt: true,
      deliveryAttempts: { orderBy: { number: 'asc' as const }, take: 10001,
        select: { id: true, number: true, status: true, startedAt: true,
          completedAt: true, providerAcceptedAt: true, deliveredAt: true } } } },
  evidence: { orderBy: { id: 'asc' as const }, take: 10001,
    select: { id: true, type: true, status: true, createdAt: true, uploadedAt: true } },
  journeySession: { select: { purpose: true, safeWalkEmergencyIncidentId: true,
    safeWalkEmergencyAt: true, redactedAt: true } },
} satisfies Prisma.IncidentSelect;
export type Source = Prisma.IncidentGetPayload<{ select: typeof SOURCE_SELECT }>;
export type FactClass = 'FACT' | 'SYSTEM_OBSERVED_FACT' | 'SOURCE_ASSERTION' | 'UNKNOWN' | 'HUMAN_NOTE';
const fact = <T>(value: T, source: string, classification: FactClass = 'SYSTEM_OBSERVED_FACT') =>
  ({ value, source, classification: value === 'UNKNOWN' ? 'UNKNOWN' as const : classification });
const unknown = (reason: string) => ({ value: null, classification: 'UNKNOWN' as const, reason });
const iso = (value: Date | null) => value?.toISOString() ?? null;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const allowed = (value: unknown, choices: readonly string[]) =>
  typeof value === 'string' && choices.includes(value) ? value : 'UNKNOWN';
const TYPES = ['INCIDENT_CREATED', 'ACTIVATION_RECORDED', 'LOCATION_ATTACHED', 'NOTIFICATIONS_QUEUED',
  'INCIDENT_RESOLVED', 'INCIDENT_CANCELLED', 'SOS_RETRIGGERED', 'EVIDENCE_ADDED'];
const SOURCES = ['MOBILE', 'INCIDENT_ORCHESTRATOR', 'EVIDENCE_SERVICE', 'SYSTEM'];

/** SafeWalk planning, guardians, notices and journey traces are never reporting inputs. */
export function institutional(source: Source): boolean {
  return !!source.facilityId && (source.journeySession?.purpose !== 'SAFEWALK' ||
    (source.journeySession.safeWalkEmergencyIncidentId === source.id && !!source.journeySession.safeWalkEmergencyAt));
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const row = value as Record<string, unknown>;
  return '{' + Object.keys(row).sort().map(key => JSON.stringify(key) + ':' + canonical(row[key])).join(',') + '}';
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const latency = (start: string, end: string | null) =>
  end && Date.parse(end) >= Date.parse(start) ? Date.parse(end) - Date.parse(start) : null;

/** No raw payload, arbitrary source string, identity, free text, coordinate or storage URL escapes. */
export function project(source: Source) {
  if (!institutional(source)) throw new Error('Incident is outside institutional reporting.');
  if ([source.timelineEvents.length, source.notifications.length, source.evidence.length,
    ...source.notifications.map(n => n.deliveryAttempts.length)].some(n => n > 10000))
    throw new Error('Source exceeds reporting safety limit; no partial report generated.');
  const events = [...source.timelineEvents].sort((a, b) =>
    a.occurredAt.getTime() - b.occurredAt.getTime() || a.sequence - b.sequence || a.id.localeCompare(b.id));
  const activation = source.timelineEvents.find(e => e.type === 'ACTIVATION_RECORDED' && object(e.payload).retrigger === false);
  const activationPayload = object(activation?.payload);
  const mode = allowed(activationPayload.activationMode, Object.values(ActivationMode));
  const activationSource = allowed(activationPayload.activationSource, Object.values(ActivationSource));
  const closure = [...source.timelineEvents].reverse().find(e =>
    e.type === (source.status === 'RESOLVED' ? 'INCIDENT_RESOLVED' : source.status === 'CANCELLED' ? 'INCIDENT_CANCELLED' : ''));
  const createdAt = source.createdAt.toISOString();
  const resolvedAt = source.status === 'RESOLVED' ? iso(source.resolvedAt) : null;
  const timeline = events.map(e => ({
    reference: e.id, sequence: e.sequence, type: allowed(e.type, TYPES),
    source: allowed(e.source, SOURCES), occurredAt: e.occurredAt.toISOString(), recordedAt: e.recordedAt.toISOString(),
    // actorUserId means on whose behalf; never label this as the action performer.
    actor: { identity: e.actorUserId ? '[protected]' : 'UNKNOWN', provenanceReference: e.id, semantics: 'ON_BEHALF_OF' },
    classification: (e.source === 'MOBILE' ? 'SOURCE_ASSERTION' : SOURCES.includes(e.source) ? 'SYSTEM_OBSERVED_FACT' : 'UNKNOWN') as FactClass,
  }));
  const notifications = source.notifications.map(n => ({
    reference: n.id, recipient: '[protected]', classification: 'SYSTEM_OBSERVED_FACT' as const,
    channel: n.channel, deliveryStatus: n.deliveryStatus,
    queuedAt: n.queuedAt.toISOString(), providerAcceptedAt: iso(n.providerAcceptedAt),
    confirmedDeliveredAt: iso(n.confirmedDeliveredAt), acknowledgedAt: iso(n.acknowledgedAt),
    attemptCount: n.attemptCount, historyComplete: n._count.deliveryEvents > 0 && n.attemptCount === n.deliveryAttempts.length,
    attempts: n.deliveryAttempts.map(a => ({ reference: a.id, number: a.number, status: a.status,
      startedAt: iso(a.startedAt), completedAt: iso(a.completedAt),
      providerAcceptedAt: iso(a.providerAcceptedAt), deliveredAt: iso(a.deliveredAt) })),
  }));
  const completeness = {
    activationProvenance: mode !== 'UNKNOWN' && activationSource !== 'UNKNOWN',
    timeline: timeline.some(e => e.type === 'INCIDENT_CREATED'),
    notificationHistory: notifications.length > 0 && notifications.every(n => n.historyComplete),
    storedEvidence: source.evidence.some(e => e.status === 'STORED'),
    closureProvenance: !!closure,
  };
  return {
    schemaVersion: SCHEMA_VERSION, generatorVersion: GENERATOR_VERSION,
    tenantId: source.facilityId!, facilityId: source.facilityId!, incidentId: source.id,
    summary: 'Recorded incident facts; no causal or legal conclusion.',
    activation: { trigger: fact(source.trigger, 'Incident.trigger'), mode: fact(mode, activation?.id ?? 'UNKNOWN'),
      source: fact(activationSource, activation?.id ?? 'UNKNOWN'), time: fact(createdAt, 'Incident.createdAt') },
    status: fact(source.status, 'Incident.status'),
    initialLocation: { availability: source.latitude !== null && source.longitude !== null ? 'RECORDED' : 'UNKNOWN',
      position: '[protected]', verification: 'UNKNOWN', source: 'Incident', classification: 'SOURCE_ASSERTION' },
    latestVerifiedLocation: unknown('No reporting authorization for precise tracking; use existing authorized incident tracking.'),
    timeline, notifications,
    acknowledgements: { incident: unknown('No authoritative incident acknowledgement writer in this base.'),
      notification: notifications.filter(n => n.acknowledgedAt !== null).map(n => ({ reference: n.reference, at: n.acknowledgedAt })) },
    responseActions: timeline.filter(e => ['INCIDENT_RESOLVED', 'INCIDENT_CANCELLED', 'SOS_RETRIGGERED'].includes(e.type)),
    evidence: source.evidence.map(e => ({ reference: e.id, type: e.type, status: e.status,
      createdAt: e.createdAt.toISOString(), uploadedAt: iso(e.uploadedAt), classification: 'SYSTEM_OBSERVED_FACT' })),
    closure: { resolvedAt, closedAt: iso(closure?.occurredAt ?? null), reference: closure?.id ?? null,
      actor: closure?.actorUserId ? '[protected]' : 'UNKNOWN',
      reason: typeof object(closure?.payload).reason === 'string' ? '[protected]' : 'UNKNOWN',
      reasonClassification: typeof object(closure?.payload).reason === 'string' ? 'HUMAN_NOTE' : 'UNKNOWN', actorSemantics: 'ON_BEHALF_OF' },
    safeWalkEmergency: source.journeySession?.purpose === 'SAFEWALK',
    sourceUpdatedAt: source.updatedAt.toISOString(),
    completeness: { checks: completeness, present: Object.values(completeness).filter(Boolean).length,
      total: Object.keys(completeness).length, definition: 'Fixed five checks; coverage only, not quality or compliance.' },
    uncertainty: ['Incident acknowledgement time unavailable.', 'Location verification unavailable.',
      'Identity, free text and precise location withheld.', 'Timeline actor denotes on-behalf-of provenance.',
      ...Object.entries(completeness).filter(([, known]) => !known).map(([key]) => key + ': UNKNOWN / not recorded')],
  };
}
export type Projection = ReturnType<typeof project>;
const counts = (values: string[]) => values.reduce<Record<string, number>>((out, key) => {
  out[key] = (out[key] ?? 0) + 1; return out;
}, {});
const mean = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return { meanMs: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null,
    known: known.length, unknown: values.length - known.length };
};
export function aggregate(rows: Projection[], at: string, staleAfterMs: number) {
  const unresolved = rows.filter(r => ['OPEN', 'ACKNOWLEDGED'].includes(r.status.value));
  return {
    incidentCount: rows.length,
    byTrigger: counts(rows.map(r => r.activation.trigger.value)),
    byActivationSource: counts(rows.map(r => r.activation.source.value)),
    byActivationMode: counts(rows.map(r => r.activation.mode.value)),
    byDayUtc: counts(rows.map(r => r.activation.time.value.slice(0, 10))),
    byFacility: counts(rows.map(r => r.facilityId)),
    acknowledgementLatency: mean(rows.map(() => null)),
    resolutionLatency: mean(rows.filter(r => r.status.value === 'RESOLVED').map(r => latency(r.activation.time.value, r.closure.resolvedAt))),
    notificationOutcomes: counts(rows.flatMap(r => r.notifications.map(n => n.deliveryStatus))),
    locationAvailability: counts(rows.map(r => r.initialLocation.availability)),
    unresolved: unresolved.length,
    staleUnresolved: unresolved.filter(r => Date.parse(at) - Date.parse(r.activation.time.value) >= staleAfterMs).length,
    staleDefinition: { ageFrom: 'Incident.createdAt', staleAfterMs },
    safeWalkEmergencyEscalations: rows.filter(r => r.safeWalkEmergency).length,
    evidenceCompleteness: { present: rows.reduce((n, r) => n + r.completeness.present, 0),
      possible: rows.reduce((n, r) => n + r.completeness.total, 0) },
    missingEvidence: rows.filter(r => !r.completeness.checks.storedEvidence).length,
    missingClosureProvenance: rows.filter(r => ['RESOLVED', 'CANCELLED'].includes(r.status.value) && !r.completeness.checks.closureProvenance).length,
    recurringZones: null, responseArrivalLatency: null, causalConclusions: null,
  };
}
