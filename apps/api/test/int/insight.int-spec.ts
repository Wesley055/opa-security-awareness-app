import { DeliveryLedgerService } from '../../src/modules/notifications/delivery-ledger.service';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService as PrismaProvider } from '../../src/prisma/prisma.service';
import { InsightModule } from '../../src/modules/insight/insight.module';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { randomUUID } from 'crypto';
import { InsightService } from '../../src/modules/insight/insight.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { prismaTest as db } from './prisma-test-client';

const windowQuery = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };
let service: InsightService;
let facilityA: string, facilityB: string, operator: string, manager: string, outsider: string, admin: string, incident: string;
beforeEach(async () => {
  service = new InsightService(db as PrismaService);
  facilityA = (await db.facility.create({ data: { name: 'A', type: 'OTHER' } })).id;
  facilityB = (await db.facility.create({ data: { name: 'B', type: 'OTHER' } })).id;
  async function user(role: 'FACILITY_OPERATOR' | 'FACILITY_ADMIN' | 'ADMIN', facilityId: string | null) {
    const id = randomUUID();
    return (await db.user.create({ data: { id, email: id + '@example.test', phoneNumber: id, firstName: 'Protected', lastName: 'Person', role, facilityId } })).id;
  }
  operator = await user('FACILITY_OPERATOR', facilityA);
  manager = await user('FACILITY_ADMIN', facilityA);
  outsider = await user('FACILITY_OPERATOR', facilityB);
  admin = await user('ADMIN', null);
  incident = (await db.incident.create({ data: { userId: operator, facilityId: facilityA, trigger: 'SOS_BUTTON', createdAt: new Date(windowQuery.from) } })).id;
});
const air = () => service.generate(manager, incident, randomUUID());
async function action() {
  const report = await air();
  return service.createAction(manager, { airId: report.reportId, requestKey: randomUUID(), category: 'DELIVERY_REVIEW',
    ownerId: operator, dueAt: '2026-01-02T00:00:00Z', priority: 'HIGH' });
}
describe('Evidence and Insight PostgreSQL', () => {
  it('isolates tenant reports, projections, aggregates, actions and exports', async () => {
    const report = await air();
    await expect(service.readAir(outsider, report.reportId)).rejects.toThrow();
    await expect(service.readAir(outsider, report.reportId, facilityA, true)).rejects.toThrow();
    await expect(service.reconcile(outsider, incident)).rejects.toThrow();
    await expect(service.generate(outsider, incident, randomUUID())).rejects.toThrow();
    await expect(service.overview(outsider, { ...windowQuery, facilityId: facilityA })).rejects.toThrow();
    expect((await service.overview(outsider, windowQuery)).metrics.incidentCount).toBe(0);
    const work = await action();
    await expect(service.updateAction(outsider, work.correctiveActionId, { expectedVersion: 1, status: 'IN_PROGRESS' })).rejects.toThrow();
  });
  it('requires explicit facility selection for unassigned platform admin and audits masked access', async () => {
    const report = await air();
    await expect(service.readAir(admin, report.reportId)).rejects.toThrow();
    const result = await service.readAir(admin, report.reportId, facilityA, true);
    expect(JSON.stringify(result)).not.toContain('@example.test');
    expect(JSON.stringify(result)).not.toContain('Protected Person');
    expect(await db.administrativeAuditEvent.count({ where: { actorUserId: admin, action: 'EVIDENCE_AIR_EXPORTED_JSON', facilityId: facilityA } })).toBe(1);
    const insight = await service.overview(admin, { ...windowQuery, facilityId: facilityA });
    expect(insight.metrics.byFacility).toEqual({ [facilityA]: 1 });
  });
  it('reevaluates current membership and account status even for previously generated reports', async () => {
    const report = await air();
    await db.user.update({ where: { id: operator }, data: { facilityId: facilityB } });
    await expect(service.readAir(operator, report.reportId)).rejects.toThrow();
    await db.user.update({ where: { id: manager }, data: { accountStatus: 'PENDING_ACTIVATION' } });
    await expect(service.readAir(manager, report.reportId)).rejects.toThrow();
  });
  it('reconciles idempotently and preserves prior snapshots after source changes', async () => {
    const a = await service.reconcile(operator, incident);
    const b = await service.reconcile(operator, incident);
    expect(a.sourceDigest).toBe(b.sourceDigest);
    expect(await db.reportingProjection.count()).toBe(1);
    expect(await db.administrativeAuditEvent.count({ where: { action: 'EVIDENCE_PROJECTION_RECONCILED' } })).toBe(1);
    const key = randomUUID(), first = await service.generate(operator, incident, key);
    expect(await service.generate(operator, incident, key)).toEqual(first);
    await db.incident.update({ where: { id: incident }, data: { status: 'RESOLVED', resolvedAt: new Date('2026-01-01T00:01:00Z') } });
    const second = await air();
    expect(second.version).toBe(2);
    expect(second.supersedesId).toBe(first.reportId);
    expect(second.sourceDigest).not.toBe(first.sourceDigest);
    expect(await service.readAir(operator, first.reportId)).toEqual(first);
    expect(first.schemaVersion).toBe(1);
    expect(first.generatorVersion).toBe('opa-evidence-1.0.0');
    expect(+first.sourceFactCutoff).toBeLessThanOrEqual(+first.generatedAt);
    expect(await db.administrativeAuditEvent.count({ where: { action: 'EVIDENCE_AIR_SUPERSEDED' } })).toBe(1);
  });
  it('serializes concurrent AIR generation and deduplicates concurrent retries', async () => {
    const key = randomUUID();
    const same = await Promise.all([service.generate(operator, incident, key), service.generate(operator, incident, key)]);
    expect(same[0]?.reportId).toBe(same[1]?.reportId);
    const distinct = await Promise.all([air(), air()]);
    expect(distinct.map(r => r.version).sort()).toEqual([2, 3]);
    expect(await db.afterIncidentReport.count()).toBe(3);
  });
  it('matches executive metrics to source facts and preserves accepted/delivered truth', async () => {
    await db.incident.update({ where: { id: incident }, data: { status: 'RESOLVED', resolvedAt: new Date('2026-01-01T00:01:00Z') } });
    await db.incidentTimelineEvent.create({ data: { incidentId: incident, sequence: 1, type: 'ACTIVATION_RECORDED', source: 'INCIDENT_ORCHESTRATOR',
      hash: 'test-only', occurredAt: new Date(windowQuery.from), payload: { activationMode: 'SILENT', activationSource: 'MANUAL', retrigger: false } } });
    const notification = await db.incidentNotification.create({ data: { incidentId: incident, contactName: 'Private recipient', contactType: 'PRIVATE', recipient: 'private@example.test',
      channel: 'EMAIL', status: 'QUEUED', acknowledgedAt: new Date() } });
    const ledger = new DeliveryLedgerService(db as PrismaService);
    const attempt = await ledger.claimIncident(notification.id);
    expect(attempt).not.toBeNull();
    await ledger.complete(attempt!.id, { success: true, provider: 'RESEND', messageId: randomUUID() });
    const result = await service.overview(operator, windowQuery);
    expect(result.metrics.incidentCount).toBe(1);
    expect(result.metrics.byActivationMode).toEqual({ SILENT: 1 });
    expect(result.metrics.byActivationSource).toEqual({ MANUAL: 1 });
    expect(result.metrics.resolutionLatency).toEqual({ meanMs: 60000, known: 1, unknown: 0 });
    expect(result.metrics.acknowledgementLatency).toEqual({ meanMs: null, known: 0, unknown: 1 });
    expect(result.metrics.notificationOutcomes).toEqual({ PROVIDER_ACCEPTED: 1 });
    expect(result.executive.incidentCount).toBe(result.metrics.incidentCount);
    expect(result.evidence.completeness).toEqual(result.metrics.evidenceCompleteness);
    expect(JSON.stringify((await air()).document)).not.toContain('private@example.test');
  });
  it('counts unresolved/stale separately and excludes private SafeWalk facts', async () => {
    const session = await db.journeySession.create({ data: { userId: operator, purpose: 'SAFEWALK', destinationLabel: 'Private home', expectedArrivalAt: new Date('2026-01-01') } });
    await db.incident.update({ where: { id: incident }, data: { journeySessionId: session.id } });
    expect((await service.overview(operator, windowQuery)).metrics.incidentCount).toBe(0);
    await expect(air()).rejects.toThrow();
    await db.journeySession.update({ where: { id: session.id }, data: { safeWalkEmergencyIncidentId: incident, safeWalkEmergencyAt: new Date() } });
    const result = await service.overview(operator, windowQuery);
    expect(result.metrics).toMatchObject({ incidentCount: 1, unresolved: 1, staleUnresolved: 1, safeWalkEmergencyEscalations: 1 });
    expect(JSON.stringify(result)).not.toContain('Private home');
    expect(JSON.stringify(await air())).not.toContain('Private home');
  });
  it('fails oversized requests rather than silently truncating', async () => {
    await db.incident.createMany({ data: Array.from({ length: 1000 }, () => ({ userId: operator, facilityId: facilityA,
      trigger: 'SYSTEM_TEST' as const, status: 'RESOLVED' as const, createdAt: new Date(windowQuery.from) })) });
    await expect(service.overview(operator, windowQuery)).rejects.toThrow('Narrow');
    expect(() => service.overview(operator, { from: 'bad', to: windowQuery.to })).toThrow();
  });
  it('enforces owner lifecycle, evidence, overdue and independent verification with audit', async () => {
    const work = await action();
    expect(work.overdue).toBe(true);
    await expect(service.updateAction(manager, work.correctiveActionId, { expectedVersion: 1, status: 'IN_PROGRESS' })).rejects.toThrow();
    const progress = await service.updateAction(operator, work.correctiveActionId, { expectedVersion: 1, status: 'IN_PROGRESS' });
    await expect(service.updateAction(operator, work.correctiveActionId, { expectedVersion: progress.version, status: 'COMPLETED' })).rejects.toThrow();
    const evidence = await db.evidence.create({ data: { incidentId: incident, type: 'DOCUMENT', status: 'STORED' } });
    const completed = await service.updateAction(operator, work.correctiveActionId, { expectedVersion: 2, status: 'COMPLETED', completionEvidenceId: evidence.id });
    expect(completed.overdue).toBe(false);
    expect(completed.completionEvidenceId).toBe(evidence.id);
    await expect(service.updateAction(operator, work.correctiveActionId, { expectedVersion: 3, status: 'VERIFIED' })).rejects.toThrow();
    const verified = await service.updateAction(manager, work.correctiveActionId, { expectedVersion: 3, status: 'VERIFIED' });
    expect(verified.verifiedAt).not.toBeNull();
    expect(await db.administrativeAuditEvent.count({ where: { resourceId: work.correctiveActionId, action: 'EVIDENCE_ACTION_VERIFIED' } })).toBe(1);
    expect((await service.compliance(manager, incident)).correctiveActions[0]?.status).toBe('VERIFIED');
    await expect(service.updateAction(manager, work.correctiveActionId, { expectedVersion: 4, status: 'CANCELLED' })).rejects.toThrow();
  });
  it('denies cross-facility owners and evidence from another incident', async () => {
    const report = await air();
    await expect(service.createAction(manager, { airId: report.reportId, requestKey: randomUUID(), category: 'EVIDENCE_REVIEW',
      ownerId: outsider, dueAt: '2026-01-02', priority: 'LOW' })).rejects.toThrow();
    const work = await action();
    await service.updateAction(operator, work.correctiveActionId, { expectedVersion: 1, status: 'IN_PROGRESS' });
    const other = await db.incident.create({ data: { userId: outsider, facilityId: facilityB, trigger: 'SOS_BUTTON' } });
    const evidence = await db.evidence.create({ data: { incidentId: other.id, type: 'DOCUMENT', status: 'STORED' } });
    await expect(service.updateAction(operator, work.correctiveActionId, { expectedVersion: 2, status: 'COMPLETED', completionEvidenceId: evidence.id })).rejects.toThrow();
  });
  it('allows exactly one concurrent action update from a version', async () => {
    const work = await action();
    const results = await Promise.allSettled([
      service.updateAction(operator, work.correctiveActionId, { expectedVersion: 1, status: 'IN_PROGRESS' }),
      service.updateAction(manager, work.correctiveActionId, { expectedVersion: 1, status: 'CANCELLED' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await db.correctiveAction.findUniqueOrThrow({ where: { id: work.correctiveActionId } })).version).toBe(2);
  });
  it('reassigns ownership only within facility and audits both identities as references', async () => {
    const work = await action();
    const updated = await service.updateAction(manager, work.correctiveActionId, { expectedVersion: 1, ownerId: manager });
    expect(updated.assignedToMe).toBe(true);
    await expect(service.updateAction(operator, work.correctiveActionId, { expectedVersion: 2, status: 'IN_PROGRESS' })).rejects.toThrow();
    expect(await db.administrativeAuditEvent.count({ where: { resourceId: work.correctiveActionId, action: 'EVIDENCE_ACTION_OWNER_CHANGED' } })).toBe(1);
  });
});

describe('Insight HTTP boundary', () => {
  it('wires guarded routes, rejects foreign scope and validates mutation DTOs', async () => {
    const module = await Test.createTestingModule({ imports: [PrismaModule, InsightModule] })
      .overrideProvider(PrismaProvider).useValue(db)
      .overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        req.user = { sub: req.headers['x-test-actor'] }; return true;
      } }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    try {
      await request(app.getHttpServer()).get('/internal/insight/overview').set('x-test-actor', operator).query(windowQuery).expect(200);
      await request(app.getHttpServer()).get('/internal/insight/overview').set('x-test-actor', outsider).query({ ...windowQuery, facilityId: facilityA }).expect(404);
      await request(app.getHttpServer()).post('/internal/insight/incidents/' + incident + '/air').set('x-test-actor', manager).send({ requestKey: randomUUID(), email: 'never-accepted@example.test' }).expect(400);
      const generated = await request(app.getHttpServer()).post('/internal/insight/incidents/' + incident + '/air').set('x-test-actor', manager).send({ requestKey: randomUUID() }).expect(201);
      const exported = await request(app.getHttpServer()).get('/internal/insight/air/' + generated.body.reportId + '/export').set('x-test-actor', operator).expect(200);
      expect(exported.headers['cache-control']).toBe('no-store');
      expect(exported.headers['content-disposition']).toContain('attachment');
      expect(JSON.stringify(exported.body)).not.toContain('@example.test');
      await db.user.update({ where: { id: operator }, data: { isActive: false } });
      await request(app.getHttpServer()).get('/internal/insight/overview').set('x-test-actor', operator).query(windowQuery).expect(403);
    } finally { await app.close(); }
  });
});

describe('Reporting resource and audit limits', () => {
  it('rejects total source history before producing any partial AIR', async () => {
    await db.incidentTimelineEvent.createMany({ data: Array.from({ length: 10001 }, (_, n) => ({
      incidentId: incident, sequence: n + 1, type: 'SYSTEM_TEST', source: 'SYSTEM', hash: 'test-only', occurredAt: new Date(windowQuery.from),
    })) });
    await expect(air()).rejects.toThrow('reporting budget');
    expect(await db.afterIncidentReport.count()).toBe(0);
    await expect(service.overview(operator, windowQuery)).rejects.toThrow('reporting budget');
  });
  it('rolls back action state when required audit persistence fails', async () => {
    const work = await action();
    await db.$executeRawUnsafe("CREATE FUNCTION insight_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'EVIDENCE_ACTION_IN_PROGRESS' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER insight_test_audit_failure BEFORE INSERT ON "AdministrativeAuditEvent" FOR EACH ROW EXECUTE FUNCTION insight_test_audit_failure()');
    try {
      await expect(service.updateAction(operator, work.correctiveActionId, { expectedVersion: 1, status: 'IN_PROGRESS' })).rejects.toThrow();
      expect(await db.correctiveAction.findUniqueOrThrow({ where: { id: work.correctiveActionId } })).toMatchObject({ status: 'OPEN', version: 1 });
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER insight_test_audit_failure ON "AdministrativeAuditEvent"');
      await db.$executeRawUnsafe('DROP FUNCTION insight_test_audit_failure()');
    }
  });
});
