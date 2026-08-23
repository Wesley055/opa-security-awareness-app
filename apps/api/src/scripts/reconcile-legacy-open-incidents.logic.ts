import type { IncidentTimelineService } from '../modules/incident-timeline/incident-timeline.service';
import type { IncidentsService } from '../modules/incidents/incidents.service';

export type ReconciliationApplyItem = {
  incidentId: string;
  userId: string;
  evidenceIncidentId: string;
  lastTriggeredAt: Date;
};

type ApplyDependencies = {
  incidentsService: Pick<
    IncidentsService,
    'reconcileLegacyDuplicate'
  >;
  timeline: Pick<
    IncidentTimelineService,
    'verifyStructuralChain' | 'verifyTailEvent'
  >;
};

/**
 * Applies one planned legacy reconciliation.
 *
 * BEFORE MUTATION:
 * Verify the recoverable historical invariant: contiguous sequence numbers
 * and stored predecessor-hash linkage.
 *
 * Historical pre-canonicalisation payload hashes are not necessarily
 * reproducible because PostgreSQL jsonb did not preserve the JavaScript
 * object-key insertion order used by the old writer.
 *
 * AFTER MUTATION:
 * Verify the newly appended tail using the current canonical hash algorithm.
 * That event was produced by current code and therefore must be reproducible.
 */
export async function reconcilePlanItem(
  item: ReconciliationApplyItem,
  dependencies: ApplyDependencies,
): Promise<
  Awaited<
    ReturnType<
      IncidentsService['reconcileLegacyDuplicate']
    >
  >
> {
  const structural =
    await dependencies.timeline.verifyStructuralChain(
      item.incidentId,
    );

  if (!structural.valid) {
    throw new Error(
      `PREVERIFY_STRUCTURAL_FAILED incident=${item.incidentId} sequence=${structural.brokenAtSequence ?? 'unknown'}`,
    );
  }

  const result =
    await dependencies.incidentsService.reconcileLegacyDuplicate(
      item.incidentId,
      item.userId,
      item.evidenceIncidentId,
      item.lastTriggeredAt,
    );

  const tail =
    await dependencies.timeline.verifyTailEvent(
      item.incidentId,
    );

  if (!tail.valid) {
    throw new Error(
      `POSTVERIFY_TAIL_FAILED incident=${item.incidentId} sequence=${tail.brokenAtSequence ?? 'unknown'}`,
    );
  }

  return result;
}