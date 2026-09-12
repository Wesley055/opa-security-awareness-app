import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CorrectiveAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTION_CATALOG } from './insight.dto';
import type { AggregateQueryDto, CreateActionDto, UpdateActionDto } from './insight.dto';
import { aggregate, digest, GENERATOR_VERSION, institutional, project, SCHEMA_VERSION, SOURCE_SELECT } from './insight.projection';
import { overdue, transition } from './insight.actions';

type Tx = Prisma.TransactionClient;
type Scope = { facilityId: string; actorId: string; role: string; manager: boolean };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const missing = () => new NotFoundException('Reporting resource not found.');
const actorSelect = { role: true, facilityId: true, isActive: true, accountStatus: true } as const;

@Injectable()
export class InsightService {
  constructor(private readonly prisma: PrismaService) {}

  /** Retry the WHOLE transaction; no side effects or provider calls inside. */
  async atomic<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
      } catch (error) {
        if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue;
        throw error;
      }
    }
  }
  private async scope(tx: Tx, actorId: string, requested?: string): Promise<Scope> {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: actorSelect });
    if (!actor?.isActive || actor.accountStatus !== 'ACTIVE' || !['ADMIN', 'FACILITY_ADMIN', 'FACILITY_OPERATOR'].includes(actor.role))
      throw new ForbiddenException('Institutional reporting access denied.');
    const facilityId = requested ?? actor.facilityId;
    if (!facilityId || (actor.role !== 'ADMIN' && facilityId !== actor.facilityId)) throw missing();
    if (!await tx.facility.findFirst({ where: { id: facilityId, isActive: true }, select: { id: true } })) throw missing();
    return { actorId, facilityId, role: actor.role, manager: actor.role !== 'FACILITY_OPERATOR' };
  }
  private audit(tx: Tx, scope: Scope, action: string, resourceId: string, afterState?: unknown, beforeState?: unknown) {
    return tx.administrativeAuditEvent.create({ data: { actorUserId: scope.actorId, actorRole: scope.role,
      facilityId: scope.facilityId, action: 'EVIDENCE_' + action, resourceId,
      ...(afterState ? { afterState: json(afterState) } : {}), ...(beforeState ? { beforeState: json(beforeState) } : {}) } });
  }
  /** Count before materializing JSON histories, so reporting cannot load an unbounded cohort. */
  private async sourceBudget(tx: Tx, scope: Scope, incidentIds: string[]) {
    const incident = { facilityId: scope.facilityId, id: { in: incidentIds } };
    const counts = await Promise.all([
      tx.incidentTimelineEvent.count({ where: { incident } }),
      tx.incidentNotification.count({ where: { incident } }),
      tx.evidence.count({ where: { incident } }),
      tx.deliveryAttempt.count({ where: { incidentNotification: { incident } } }),
    ]);
    if (counts.reduce((sum, count) => sum + count, 0) > 10000)
      throw new BadRequestException('Source history exceeds reporting budget; narrow the window. No partial report returned.');
  }
  private async source(tx: Tx, scope: Scope, incidentId: string) {
    await this.sourceBudget(tx, scope, [incidentId]);
    const row = await tx.incident.findFirst({ where: { id: incidentId, facilityId: scope.facilityId }, select: SOURCE_SELECT });
    if (!row || !institutional(row)) throw missing();
    return row;
  }
  private async snapshot(tx: Tx, scope: Scope, incidentId: string) {
    const source = await this.source(tx, scope, incidentId);
    const document = project(source);
    const sourceDigest = digest(document);
    const clock = await tx.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
    const at = clock[0]?.at;
    if (!at) throw new Error('Database snapshot time unavailable.');
    const prior = await tx.reportingProjection.findUnique({ where: { facilityId_incidentId: { facilityId: scope.facilityId, incidentId } } });
    if (!prior || prior.sourceDigest !== sourceDigest || prior.generatorVersion !== GENERATOR_VERSION) {
      await tx.reportingProjection.upsert({ where: { facilityId_incidentId: { facilityId: scope.facilityId, incidentId } },
        create: { facilityId: scope.facilityId, incidentId, sourceDigest, generatorVersion: GENERATOR_VERSION, sourceCutoff: at!, document: json(document) },
        update: { sourceDigest, generatorVersion: GENERATOR_VERSION, sourceCutoff: at!, document: json(document) } });
      await this.audit(tx, scope, 'PROJECTION_RECONCILED', incidentId, { sourceDigest, generatorVersion: GENERATOR_VERSION });
    }
    return { document, sourceDigest, sourceCutoff: at! };
  }
  reconcile(actorId: string, incidentId: string, facilityId?: string) {
    return this.atomic(async tx => {
      const scope = await this.scope(tx, actorId, facilityId);
      const result = await this.snapshot(tx, scope, incidentId);
      await this.audit(tx, scope, 'PROJECTION_READ', incidentId);
      return result;
    });
  }
  generate(actorId: string, incidentId: string, requestKey: string, facilityId?: string) {
    return this.atomic(async tx => {
      const scope = await this.scope(tx, actorId, facilityId);
      await this.source(tx, scope, incidentId);
      const existing = await tx.afterIncidentReport.findUnique({ where: { facilityId_incidentId_requestKey: { facilityId: scope.facilityId, incidentId, requestKey } } });
      if (existing) { await this.audit(tx, scope, 'AIR_REPLAY', existing.id); return this.airView(existing); }
      const snapshot = await this.snapshot(tx, scope, incidentId);
      const prior = await tx.afterIncidentReport.findFirst({ where: { facilityId: scope.facilityId, incidentId }, orderBy: { version: 'desc' } });
      const report = await tx.afterIncidentReport.create({ data: {
        facilityId: scope.facilityId, incidentId, version: (prior?.version ?? 0) + 1, requestKey,
        schemaVersion: SCHEMA_VERSION, generatorVersion: GENERATOR_VERSION, generatedBy: actorId,
        generatedAt: snapshot.sourceCutoff, sourceCutoff: snapshot.sourceCutoff,
        sourceDigest: snapshot.sourceDigest, document: json(snapshot.document), supersedesId: prior?.id,
      } });
      await this.audit(tx, scope, prior ? 'AIR_SUPERSEDED' : 'AIR_GENERATED', report.id,
        { version: report.version, supersedesId: prior?.id ?? null, sourceDigest: report.sourceDigest });
      return this.airView(report);
    });
  }
  private airView(row: { id: string; facilityId: string; incidentId: string; version: number; schemaVersion: number;
    generatorVersion: string; generatedAt: Date; sourceCutoff: Date; sourceDigest: string; supersedesId: string | null; document: Prisma.JsonValue }) {
    return { reportId: row.id, tenantId: row.facilityId, facilityId: row.facilityId, incidentId: row.incidentId,
      version: row.version, schemaVersion: row.schemaVersion, generatorVersion: row.generatorVersion,
      generatedAt: row.generatedAt, generatedBy: '[protected]', generatorAuditReference: row.id,
      sourceFactCutoff: row.sourceCutoff, sourceDigest: row.sourceDigest, supersedesId: row.supersedesId, document: row.document };
  }
  readAir(actorId: string, id: string, facilityId?: string, exportJson = false) {
    return this.atomic(async tx => {
      const scope = await this.scope(tx, actorId, facilityId);
      const row = await tx.afterIncidentReport.findFirst({ where: { id, facilityId: scope.facilityId } });
      if (!row) throw missing();
      await this.source(tx, scope, row.incidentId);
      await this.audit(tx, scope, exportJson ? 'AIR_EXPORTED_JSON' : 'AIR_READ', id);
      return this.airView(row);
    });
  }
  overview(actorId: string, query: AggregateQueryDto) {
    const from = new Date(query.from), to = new Date(query.to);
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 366 * 86400000)
      throw new BadRequestException('Use a valid half-open time window no longer than 366 days.');
    return this.atomic(async tx => {
      const scope = await this.scope(tx, actorId, query.facilityId);
      const cohort = await tx.incident.findMany({ where: { facilityId: scope.facilityId, createdAt: { gte: from, lt: to } },
        select: { id: true }, orderBy: { id: 'asc' }, take: 1001 });
      if (cohort.length > 1000) throw new BadRequestException('Narrow the time window; no partial aggregates returned.');
      await this.sourceBudget(tx, scope, cohort.map(row => row.id));
      const rows = await tx.incident.findMany({ where: { facilityId: scope.facilityId, id: { in: cohort.map(row => row.id) } },
        select: SOURCE_SELECT, orderBy: { id: 'asc' } });
      const at = new Date();
      const metrics = aggregate(rows.filter(institutional).map(project), at.toISOString(), 24 * 60 * 60 * 1000);
      const actions = await tx.correctiveAction.findMany({ where: { facilityId: scope.facilityId, incidentId: { in: rows.filter(institutional).map(r => r.id) } }, take: 10001 });
      if (actions.length > 10000) throw new BadRequestException('Narrow the time window.');
      const actionMetrics = { total: actions.length, open: actions.filter(a => ['OPEN', 'IN_PROGRESS'].includes(a.status)).length,
        completed: actions.filter(a => a.status === 'COMPLETED').length, verified: actions.filter(a => a.status === 'VERIFIED').length,
        overdue: actions.filter(a => overdue(a.status, a.dueAt, at)).length };
      await this.audit(tx, scope, 'INSIGHT_READ', scope.facilityId, { from: from.toISOString(), to: to.toISOString() });
      return { schemaVersion: SCHEMA_VERSION, tenantId: scope.facilityId, facilityId: scope.facilityId,
        from: from.toISOString(), to: to.toISOString(), observedAt: at.toISOString(), source: 'AUTHORITATIVE_TRANSACTION_SNAPSHOT',
        metrics, correctiveActions: actionMetrics,
        executive: { incidentCount: metrics.incidentCount, trend: metrics.byDayUtc, unresolved: metrics.unresolved,
          resolutionLatency: metrics.resolutionLatency, correctiveActions: actionMetrics, evidenceCompleteness: metrics.evidenceCompleteness },
        operations: { acknowledgementLatency: metrics.acknowledgementLatency, resolutionLatency: metrics.resolutionLatency,
          deliveryOutcomes: metrics.notificationOutcomes, facilities: metrics.byFacility },
        risk: { categories: metrics.byTrigger, overdueCorrectiveActions: actionMetrics.overdue, recurringZones: null },
        evidence: { completeness: metrics.evidenceCompleteness, missingEvidence: metrics.missingEvidence,
          missingClosureProvenance: metrics.missingClosureProvenance, sourceAuditCoverage: null },
        uncertainty: ['No authoritative incident acknowledgement or responder-arrival time.', 'No regulatory compliance or causal conclusions.',
          'Facility comparison is limited to this one authorized facility.', 'Evidence coverage does not prove evidence quality.'] };
    });
  }
  private async owner(tx: Tx, scope: Scope, ownerId: string) {
    const owner = await tx.user.findFirst({ where: { id: ownerId, facilityId: scope.facilityId, isActive: true,
      accountStatus: 'ACTIVE', role: { in: ['FACILITY_OPERATOR', 'FACILITY_ADMIN'] } }, select: { id: true } });
    if (!owner) throw missing();
  }
  private actionView(row: CorrectiveAction, actorId: string, at = new Date()) {
    return { correctiveActionId: row.id, incidentId: row.incidentId, airId: row.airId, tenantId: row.facilityId, facilityId: row.facilityId,
      title: row.title, description: row.description, category: row.category, owner: '[protected]', assignedToMe: row.ownerId === actorId,
      dueAt: row.dueAt, priority: row.priority, status: row.status, overdue: overdue(row.status, row.dueAt, at), version: row.version,
      createdBy: '[protected]', createdAt: row.createdAt, updatedAt: row.updatedAt, completionEvidenceId: row.completionEvidenceId,
      completedAt: row.completedAt, verifiedBy: row.verifiedBy ? '[protected]' : null, verifiedAt: row.verifiedAt, auditReference: row.id };
  }
  createAction(actorId: string, dto: CreateActionDto) {
    return this.atomic(async tx => {
      const scope = await this.scope(tx, actorId, dto.facilityId);
      if (!scope.manager) throw new ForbiddenException('Manager authority required.');
      const air = await tx.afterIncidentReport.findFirst({ where: { id: dto.airId, facilityId: scope.facilityId } });
      if (!air) throw missing();
      await this.source(tx, scope, air.incidentId);
      await this.owner(tx, scope, dto.ownerId);
      const existing = await tx.correctiveAction.findUnique({ where: { facilityId_requestKey: { facilityId: scope.facilityId, requestKey: dto.requestKey } } });
      if (existing) {
        if (existing.airId !== dto.airId || existing.category !== dto.category || existing.ownerId !== dto.ownerId ||
          +existing.dueAt !== +new Date(dto.dueAt) || existing.priority !== dto.priority) throw new ConflictException('Request key already used.');
        await this.audit(tx, scope, 'ACTION_REPLAY', existing.id); return this.actionView(existing, actorId);
      }
      const row = await tx.correctiveAction.create({ data: { facilityId: scope.facilityId, incidentId: air.incidentId,
        airId: air.id, requestKey: dto.requestKey, category: dto.category, ...ACTION_CATALOG[dto.category],
        ownerId: dto.ownerId, dueAt: new Date(dto.dueAt), priority: dto.priority, createdBy: actorId } });
      await this.audit(tx, scope, 'ACTION_CREATED', row.id, { ownerId: row.ownerId, status: row.status, version: row.version });
      return this.actionView(row, actorId);
    });
  }
  updateAction(actorId: string, id: string, dto: UpdateActionDto) {
    return this.atomic(async tx => {
      const scope = await this.scope(tx, actorId, dto.facilityId);
      const row = await tx.correctiveAction.findFirst({ where: { id, facilityId: scope.facilityId } });
      if (!row) throw missing();
      await this.source(tx, scope, row.incidentId);
      if (row.version !== dto.expectedVersion) throw new ConflictException('Corrective action has changed; reload.');
      if (!dto.ownerId && !dto.status) throw new BadRequestException('An ownership or status change is required.');
      if (dto.ownerId && dto.status) throw new BadRequestException('Change ownership separately from status.');
      if (dto.completionEvidenceId && dto.status !== 'COMPLETED') throw new BadRequestException('Completion evidence is accepted only on completion.');
      const data: Prisma.CorrectiveActionUpdateManyMutationInput = { version: { increment: 1 } };
      if (dto.ownerId) {
        if (!scope.manager || !['OPEN', 'IN_PROGRESS'].includes(row.status)) throw new ForbiddenException('Only a manager can reassign active work.');
        await this.owner(tx, scope, dto.ownerId); data.ownerId = dto.ownerId;
      }
      if (dto.status) {
        const evidenceId = dto.status === 'COMPLETED' ? dto.completionEvidenceId : row.completionEvidenceId;
        const evidence = evidenceId ? await tx.evidence.findFirst({ where: { id: evidenceId, incidentId: row.incidentId, status: 'STORED' }, select: { id: true } }) : null;
        transition(row.status, dto.status, actorId, row.ownerId, scope.manager, !!evidence);
        data.status = dto.status;
        if (dto.status === 'COMPLETED') { data.completionEvidenceId = evidence!.id; data.completedAt = new Date(); }
        if (dto.status === 'VERIFIED') { data.verifiedBy = actorId; data.verifiedAt = new Date(); }
        if (dto.status === 'IN_PROGRESS' && row.status === 'COMPLETED') {
          data.completionEvidenceId = null; data.completedAt = null; data.verifiedBy = null; data.verifiedAt = null;
        }
      }
      const changed = await tx.correctiveAction.updateMany({ where: { id, facilityId: scope.facilityId, version: dto.expectedVersion }, data });
      if (changed.count !== 1) throw new ConflictException('Corrective action has changed; reload.');
      const updated = await tx.correctiveAction.findUniqueOrThrow({ where: { id } });
      const state = (a: CorrectiveAction) => ({ version: a.version, status: a.status, ownerId: a.ownerId,
        completionEvidenceId: a.completionEvidenceId, completedAt: a.completedAt, verifiedBy: a.verifiedBy, verifiedAt: a.verifiedAt });
      await this.audit(tx, scope, dto.ownerId ? 'ACTION_OWNER_CHANGED' : 'ACTION_' + dto.status, id, state(updated), state(row));
      return this.actionView(updated, actorId);
    });
  }
  compliance(actorId: string, incidentId: string, facilityId?: string) {
    return this.atomic(async tx => {
      const scope = await this.scope(tx, actorId, facilityId);
      await this.source(tx, scope, incidentId);
      const reports = await tx.afterIncidentReport.findMany({ where: { incidentId, facilityId: scope.facilityId }, orderBy: { version: 'desc' }, take: 101 });
      const actions = await tx.correctiveAction.findMany({ where: { incidentId, facilityId: scope.facilityId }, orderBy: { id: 'asc' }, take: 1001 });
      if (reports.length > 100 || actions.length > 1000) throw new BadRequestException('Evidence package exceeds safety limit.');
      await this.audit(tx, scope, 'COMPLIANCE_EVIDENCE_READ', incidentId);
      return { schemaVersion: SCHEMA_VERSION, facilityId: scope.facilityId, incidentId,
        report: reports[0] ? this.airView(reports[0]) : null,
        reportVersions: reports.map(r => ({ reportId: r.id, version: r.version, supersedesId: r.supersedesId })),
        correctiveActions: actions.map(a => this.actionView(a, actorId)),
        complianceClaim: null, regulatoryMappings: [],
        uncertainty: ['AIR reflects its stored cutoff; actions reflect this read.', 'No report exists until AIR generation is requested.'] };
    });
  }
}
