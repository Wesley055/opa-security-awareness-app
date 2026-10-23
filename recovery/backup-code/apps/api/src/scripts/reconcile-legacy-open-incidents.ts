import { NestFactory } from '@nestjs/core';
import { IncidentStatus } from '@prisma/client';
import { IncidentsModule } from '../modules/incidents/incidents.module';
import { IncidentsService } from '../modules/incidents/incidents.service';
import { IncidentTimelineService } from '../modules/incident-timeline/incident-timeline.service';
import { PrismaService } from '../prisma/prisma.service';
import { reconcilePlanItem } from './reconcile-legacy-open-incidents.logic';

type RepairPlanItem = {
  incidentId: string;
  userId: string;
  journeySessionId: string | null;
  createdAt: Date;
  lastTriggeredAt: Date;
  evidenceIncidentId: string;
  evidenceResolvedAt: Date;
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(
    IncidentsModule,
    {
      logger: ['error', 'warn', 'log'],
    },
  );

  try {
    const prisma = app.get(PrismaService);
    const incidentsService = app.get(IncidentsService);
    const timeline = app.get(IncidentTimelineService);

    const all = await prisma.incident.findMany({
      select: {
        id: true,
        userId: true,
        journeySessionId: true,
        status: true,
        createdAt: true,
        lastTriggeredAt: true,
        resolvedAt: true,
      },
      orderBy: [
        { userId: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    const byUser = new Map<string, typeof all>();

    for (const incident of all) {
      const rows = byUser.get(incident.userId) ?? [];
      rows.push(incident);
      byUser.set(incident.userId, rows);
    }

    const plan: RepairPlanItem[] = [];

    const unsupported: Array<{
      incidentId: string;
      userId: string;
      createdAt: Date;
      reason: string;
    }> = [];

    for (const [userId, rows] of byUser) {
      for (const incident of rows) {
        if (incident.status !== IncidentStatus.OPEN) {
          continue;
        }

        if (incident.lastTriggeredAt === null) {
          unsupported.push({
            incidentId: incident.id,
            userId,
            createdAt: incident.createdAt,
            reason: 'MISSING_LAST_TRIGGERED_AT',
          });
          continue;
        }

        // Rows are ordered ASC, therefore find() returns the earliest later
        // RESOLVED incident: the tightest available historical evidence.
        const evidence = rows.find(
          (candidate) =>
            candidate.status === IncidentStatus.RESOLVED &&
            candidate.resolvedAt !== null &&
            candidate.createdAt > incident.createdAt,
        );

        if (!evidence || evidence.resolvedAt === null) {
          unsupported.push({
            incidentId: incident.id,
            userId,
            createdAt: incident.createdAt,
            reason: 'NO_LATER_RESOLVED_INCIDENT',
          });
          continue;
        }

        plan.push({
          incidentId: incident.id,
          userId,
          journeySessionId: incident.journeySessionId,
          createdAt: incident.createdAt,
          lastTriggeredAt: incident.lastTriggeredAt,
          evidenceIncidentId: evidence.id,
          evidenceResolvedAt: evidence.resolvedAt,
        });
      }
    }

    console.log('===== LEGACY OPEN INCIDENT RECONCILIATION =====');
    console.log(`mode=${apply ? 'APPLY' : 'DRY_RUN'}`);
    console.log(`repair_count=${plan.length}`);
    console.log(`unsupported_open_count=${unsupported.length}`);

    console.table(
      plan.map((item) => ({
        incidentId: item.incidentId,
        userId: item.userId,
        journeySessionId: item.journeySessionId,
        createdAt: item.createdAt.toISOString(),
        lastTriggeredAt: item.lastTriggeredAt.toISOString(),
        evidenceIncidentId: item.evidenceIncidentId,
        evidenceResolvedAt: item.evidenceResolvedAt.toISOString(),
      })),
    );

    if (unsupported.length > 0) {
      console.log('');
      console.log('===== OPEN INCIDENTS WITHOUT SAFE EVIDENCE =====');

      console.table(
        unsupported.map((item) => ({
          incidentId: item.incidentId,
          userId: item.userId,
          createdAt: item.createdAt.toISOString(),
          reason: item.reason,
        })),
      );

      throw new Error(
        'Reconciliation refused: one or more OPEN incidents lack safe reconciliation evidence.',
      );
    }

    if (!apply) {
      console.log('');
      console.log('DRY RUN ONLY - DATABASE NOT MODIFIED');
      console.log('reconciliation_dry_run=PASS');
      return;
    }

    console.log('');
    console.log('===== APPLYING RECONCILIATION =====');

    let repaired = 0;
    let refusedChanged = 0;

    for (const item of plan) {
      try {
        // Safety order:
        //
        //   structural verification
        //     -> lifecycle mutation
        //       -> current-tail verification
        //
        // Historical hashes are not rewritten or falsely treated as
        // current-canonical hashes.
        const result = await reconcilePlanItem(
          item,
          {
            incidentsService,
            timeline,
          },
        );

        repaired += 1;

        console.log(
          `reconciled=${item.incidentId} status=${result.status} evidence=${item.evidenceIncidentId} structure=VALID tail=VALID`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        if (
          message.includes(
            'Incident was retriggered after the reconciliation plan was computed.',
          )
        ) {
          refusedChanged += 1;

          console.warn(
            `REFUSED_CHANGED incident=${item.incidentId} reason=${message}`,
          );

          continue;
        }

        throw error;
      }
    }

    const remainingOpen = await prisma.incident.findMany({
      where: {
        status: IncidentStatus.OPEN,
      },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        lastTriggeredAt: true,
      },
      orderBy: [
        { userId: 'asc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });

    const counts = new Map<string, number>();

    for (const incident of remainingOpen) {
      counts.set(
        incident.userId,
        (counts.get(incident.userId) ?? 0) + 1,
      );
    }

    const duplicateUsers = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([userId, openCount]) => ({
        userId,
        openCount,
      }));

    console.log('');
    console.log('===== POST-REPAIR VERIFICATION =====');
    console.log(`repaired=${repaired}`);
    console.log(`refused_changed=${refusedChanged}`);
    console.log(`remaining_open=${remainingOpen.length}`);
    console.log(`remaining_duplicate_users=${duplicateUsers.length}`);

    if (remainingOpen.length > 0) {
      console.log('');
      console.log('===== REMAINING OPEN INCIDENTS =====');

      console.table(
        remainingOpen.map((incident) => ({
          incidentId: incident.id,
          userId: incident.userId,
          createdAt: incident.createdAt.toISOString(),
          lastTriggeredAt:
            incident.lastTriggeredAt?.toISOString() ?? null,
        })),
      );
    }

    if (duplicateUsers.length > 0) {
      console.log('');
      console.log('===== DUPLICATE OPEN USERS REMAIN =====');
      console.table(duplicateUsers);

      throw new Error(
        'Reconciliation completed but multiple OPEN incidents remain for at least one user.',
      );
    }

    console.log('legacy_reconciliation_apply=PASS');
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});