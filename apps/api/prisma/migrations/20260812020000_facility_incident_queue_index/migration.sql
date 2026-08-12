-- Sprint 13C-5 - the facility incident queue index.
--
-- The operator console orders by createdAt DESC, id DESC and filters on
-- facilityId plus status. @@index([facilityId, status]) already existed but
-- cannot serve an ordered scan, so every page would sort in memory.
--
-- The trailing id is not decoration. It is the cursor tiebreaker: two
-- incidents created in the same millisecond would otherwise page
-- non-deterministically, and a row could be served twice or skipped. In
-- this queue a skipped row is somebody's emergency.
--
-- NOT CONCURRENTLY: Prisma runs each migration inside a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run in one. At present row counts the
-- lock is instantaneous. If Incident ever grows large enough for this to
-- matter, the index must be created outside the migration runner.

CREATE INDEX "Incident_facilityId_status_createdAt_id_idx"
  ON "Incident"("facilityId", "status", "createdAt" DESC, "id" DESC);