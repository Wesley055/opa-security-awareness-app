import type {
  ProtectedSnapshotsService,
  SnapshotKind,
} from "./protected-snapshots.service";

export interface BackfillItem {
  sourceId: string;
  kind: SnapshotKind;
  expectedUpdatedAt: Date;
}
export interface BackfillOutcome {
  sourceId: string;
  kind: SnapshotKind;
  status: "READY" | "PROTECTED" | "ALREADY_PROTECTED" | "FAILED";
}
/** The job owner supplies durable storage. Checkpoints contain opaque references and safe statuses only. */
export interface BackfillCheckpoint {
  record(outcome: BackfillOutcome): Promise<void>;
}

/** Bounded, one source transaction at a time. Replay after a checkpoint failure is safe and re-verifies ciphertext. */
export async function runProtectedBackfillBatch(
  snapshots: Pick<ProtectedSnapshotsService, "backfill">,
  actorUserId: string,
  tenantId: string,
  items: readonly BackfillItem[],
  checkpoint: BackfillCheckpoint,
  apply = false,
) {
  if (items.length > 100)
    throw new Error("Protected backfill batch exceeds 100 records.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (items.some(item => !uuid.test(item.sourceId) || !['INVITATION_SNAPSHOT','NOTIFICATION_SNAPSHOT'].includes(item.kind) || !Number.isFinite(item.expectedUpdatedAt.getTime()))) {
    throw new Error('Invalid protected backfill manifest.');
  }
  const counts = {
    attempted: 0,
    ready: 0,
    protected: 0,
    verifiedExisting: 0,
    failed: 0,
  };
  for (const item of items) {
    let outcome: BackfillOutcome;
    try {
      const result = await snapshots.backfill(
        actorUserId,
        tenantId,
        item.kind,
        item.sourceId,
        item.expectedUpdatedAt,
        apply,
      );
      outcome = {
        sourceId: item.sourceId,
        kind: item.kind,
        status: result.status,
      };
    } catch {
      outcome = { sourceId: item.sourceId, kind: item.kind, status: "FAILED" };
    }
    // Never advance to the next row if its predecessor could not be checkpointed.
    try {
      await checkpoint.record(outcome);
    } catch {
      throw new Error(
        "Protected backfill checkpoint unavailable; replay the batch.",
      );
    }
    counts.attempted++;
    if (outcome.status === "PROTECTED") counts.protected++;
    else if (outcome.status === "ALREADY_PROTECTED") counts.verifiedExisting++;
    else if (outcome.status === "READY") counts.ready++;
    else counts.failed++;
  }
  return counts;
}
