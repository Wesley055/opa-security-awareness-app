-- Sprint 13C-2 - operator account activation lifecycle.
--
-- Every existing account is an account somebody registered and uses, so all
-- of them migrate to ACTIVE. PENDING_ACTIVATION is reserved for seats an
-- administrator provisions on someone else's behalf.
--
-- Measured on 11 August 2026, before writing this:
--   production  4 users
--   local dev   7 users
-- All of them ACTIVE by the DEFAULT below; no data migration is required.
--
-- passwordHash BECOMES NULLABLE. A provisioned seat has never chosen a
-- password, and a placeholder credential would be a hashable value that
-- nothing can match but every reader must reason about. Null says what is
-- true. login() narrows on it.
--
-- Only the activation token HASH is stored, as with IncidentAccessToken.
-- The raw token exists once, in the URL handed to the operator.

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PENDING_ACTIVATION');

ALTER TABLE "User"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "activationTokenHash" TEXT,
  ADD COLUMN "activationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "invitedByUserId" UUID;

-- PostgreSQL permits many NULLs under a unique index, so every existing row
-- coexists here.
CREATE UNIQUE INDEX "User_activationTokenHash_key"
  ON "User"("activationTokenHash");

CREATE INDEX "User_invitedByUserId_idx"
  ON "User"("invitedByUserId");

CREATE INDEX "User_accountStatus_idx"
  ON "User"("accountStatus");

-- SET NULL rather than CASCADE: deleting the administrator who invited an
-- operator must not delete the operator.
ALTER TABLE "User"
  ADD CONSTRAINT "User_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;