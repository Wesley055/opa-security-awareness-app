-- Sprint 13B - generalise facility Command Center authorization.
--
-- Measured before this migration:
--   local:      USER=7, HOSPITAL_STAFF=0
--   production: USER=4, HOSPITAL_STAFF=0
--
-- PostgreSQL cannot DROP one enum value in place. Replace the type cleanly
-- rather than leaving an orphaned HOSPITAL_STAFF value that future code could
-- accidentally reuse.
--
-- IMPORTANT: this migration intentionally fails if a row still contains
-- HOSPITAL_STAFF. The pre-migration measurements are therefore part of the
-- deployment evidence, not a compatibility shim.

ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'USER',
  'RESPONDER',
  'ADMIN',
  'FACILITY_OPERATOR'
);

ALTER TABLE "User"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "role"
  TYPE "UserRole"
  USING ("role"::text::"UserRole");

ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'USER';

DROP TYPE "UserRole_old";
