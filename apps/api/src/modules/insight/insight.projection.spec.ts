import { ActivationSource } from '../emergency-detection/dto/trigger-request.dto';
import { aggregate, canonical, digest, institutional, latency, project } from './insight.projection';
import type { Source } from './insight.projection';
import { overdue, transition } from './insight.actions';

export function fixture(): Source {
  return { id: 'incident-a', facilityId: 'facility-a', trigger: 'SOS_BUTTON', status: 'OPEN',
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    resolvedAt: null, latitude: null, longitude: null, journeySession: null, evidence: [], notifications: [], timelineEvents: [] };
}
describe('Evidence projections', () => {
  it.each(Object.values(ActivationSource))('preserves authoritative activation source %s', activationSource => {
    const source = fixture();
    source.timelineEvents = [{ id: 'activation', sequence: 1, type: 'ACTIVATION_RECORDED',
      source: 'INCIDENT_ORCHESTRATOR', actorUserId: null, payload: { activationMode: 'SILENT', activationSource, retrigger: false },
      occurredAt: source.createdAt, recordedAt: source.createdAt }];
    expect(aggregate([project(source)], '2026-01-01', 86400000).byActivationSource).toEqual({ [activationSource]: 1 });
  });
  it('is deterministic across JSON key ordering', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
    expect(digest(project(fixture()))).toBe(digest(project(fixture())));
  });
  it('keeps absent facts unknown without inventing acknowledgements', () => {
    const result = project(fixture());
    expect(result.activation.mode.value).toBe('UNKNOWN');
    expect(result.acknowledgements.incident.classification).toBe('UNKNOWN');
    expect(result.completeness.present).toBe(0);
    expect(result.closure.resolvedAt).toBeNull();
    expect(result.activation.mode.classification).toBe('UNKNOWN');
    expect(result.closure.reasonClassification).toBe('UNKNOWN');
  });
  it('does not admit private SafeWalk, including missed arrival', () => {
    const source = fixture(); source.journeySession = { purpose: 'SAFEWALK', safeWalkEmergencyAt: null, safeWalkEmergencyIncidentId: null, redactedAt: null };
    expect(institutional(source)).toBe(false);
    expect(() => project(source)).toThrow();
    source.journeySession.safeWalkEmergencyIncidentId = source.id;
    expect(institutional(source)).toBe(false);
    source.journeySession.safeWalkEmergencyAt = source.createdAt;
    expect(project(source).safeWalkEmergency).toBe(true);
  });
  it('sorts chronology by occurrence then sequence and removes unsafe payloads', () => {
    const source = fixture();
    source.timelineEvents = [2, 1].map(sequence => ({ id: 'event-' + sequence, sequence,
      type: 'INCIDENT_CREATED', source: 'MOBILE', actorUserId: 'protected-user',
      payload: { phone: '+2348012345678', email: 'secret@example.com', latitude: 1, guardian: 'secret' },
      occurredAt: source.createdAt, recordedAt: source.createdAt }));
    const output = project(source);
    expect(output.timeline.map(e => e.sequence)).toEqual([1, 2]);
    expect(output.timeline[0]?.classification).toBe('SOURCE_ASSERTION');
    expect(JSON.stringify(output)).not.toMatch(/2348012345678|secret@example|protected-user|guardian/);
    expect(output.timeline[0]?.actor.provenanceReference).toBe('event-1');
  });
  it('does not copy arbitrary event type or source strings', () => {
    const source = fixture(); source.timelineEvents = [{ id: 'e', sequence: 1, type: 'secret@example.com', source: '+2348012345678', actorUserId: null, payload: null, occurredAt: source.createdAt, recordedAt: source.createdAt }];
    expect(project(source).timeline[0]).toMatchObject({ type: 'UNKNOWN', source: 'UNKNOWN', classification: 'UNKNOWN' });
  });
  it('counts accepted delivery separately from confirmed delivery and notification acknowledgement', () => {
    const source = fixture(); source.notifications = [{ id: 'notification', channel: 'SMS', deliveryStatus: 'PROVIDER_ACCEPTED',
      queuedAt: source.createdAt, providerAcceptedAt: source.createdAt, confirmedDeliveredAt: null,
      acknowledgedAt: source.createdAt, attemptCount: 1, _count: { deliveryEvents: 1 }, updatedAt: source.createdAt, deliveryAttempts: [] }];
    const row = project(source), result = aggregate([row], '2026-01-02T00:00:00Z', 86400000);
    expect(result.notificationOutcomes).toEqual({ PROVIDER_ACCEPTED: 1 });
    expect(row.notifications[0]?.confirmedDeliveredAt).toBeNull();
    expect(row.notifications[0]?.historyComplete).toBe(false);
    expect(result.acknowledgementLatency).toEqual({ meanMs: null, known: 0, unknown: 1 });
  });
  it('does not call legacy zero-attempt history complete without durable queue evidence', () => {
    const source = fixture();
    source.notifications = [{ id: 'legacy', channel: 'SMS', deliveryStatus: 'UNKNOWN', queuedAt: source.createdAt,
      providerAcceptedAt: null, confirmedDeliveredAt: null, acknowledgedAt: null, attemptCount: 0,
      updatedAt: source.createdAt, deliveryAttempts: [], _count: { deliveryEvents: 0 } }];
    expect(project(source).notifications[0]?.historyComplete).toBe(false);
    expect(project(source).completeness.checks.notificationHistory).toBe(false);
  });
  it('calculates counts, resolution latency, cancellation and stale ages honestly', () => {
    const open = project(fixture()); const resolved = fixture(); resolved.status = 'RESOLVED'; resolved.resolvedAt = new Date('2026-01-01T00:01:00Z');
    const cancelled = fixture(); cancelled.status = 'CANCELLED';
    const result = aggregate([open, project(resolved), project(cancelled)], '2026-01-02T00:00:00Z', 86400000);
    expect(result.incidentCount).toBe(3); expect(result.unresolved).toBe(1); expect(result.staleUnresolved).toBe(1);
    expect(result.resolutionLatency).toEqual({ meanMs: 60000, known: 1, unknown: 0 });
    expect(result.byFacility).toEqual({ 'facility-a': 3 });
    expect(result.causalConclusions).toBeNull();
    expect(latency('2026-01-02', '2026-01-01')).toBeNull();
  });
  it('has deterministic completeness denominators, including an empty cohort', () => {
    expect(aggregate([], '2026-01-01', 86400000).evidenceCompleteness).toEqual({ present: 0, possible: 0 });
    expect(aggregate([project(fixture())], '2026-01-01', 86400000).evidenceCompleteness).toEqual({ present: 0, possible: 5 });
  });
});
describe('Corrective-action policy', () => {
  it('permits owner progress and independent verification', () => {
    expect(() => transition('OPEN', 'IN_PROGRESS', 'owner', 'owner', false, false)).not.toThrow();
    expect(() => transition('IN_PROGRESS', 'COMPLETED', 'owner', 'owner', false, true)).not.toThrow();
    expect(() => transition('COMPLETED', 'VERIFIED', 'manager', 'owner', true, true)).not.toThrow();
  });
  it.each(['VERIFIED', 'CANCELLED'] as const)('rejects changes to terminal %s', status => {
    expect(() => transition(status, 'OPEN', 'owner', 'owner', true, true)).toThrow();
  });
  it('rejects skipped completion, missing evidence, other owners and self-verification', () => {
    expect(() => transition('OPEN', 'COMPLETED', 'owner', 'owner', true, true)).toThrow();
    expect(() => transition('IN_PROGRESS', 'COMPLETED', 'owner', 'owner', false, false)).toThrow();
    expect(() => transition('OPEN', 'IN_PROGRESS', 'other', 'owner', true, true)).toThrow();
    expect(() => transition('COMPLETED', 'VERIFIED', 'owner', 'owner', true, true)).toThrow();
  });
  it('derives overdue only for unfinished work, without changing lifecycle', () => {
    const due = new Date('2026-01-01'), at = new Date('2026-01-02');
    expect(overdue('OPEN', due, at)).toBe(true);
    expect(overdue('IN_PROGRESS', due, at)).toBe(true);
    expect(overdue('COMPLETED', due, at)).toBe(false);
    expect(overdue('VERIFIED', due, at)).toBe(false);
    expect(overdue('OPEN', due, due)).toBe(false);
  });
});
