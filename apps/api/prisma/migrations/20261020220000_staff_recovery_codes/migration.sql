-- In-session password recovery codes for staff. Additive only: one new table.
BEGIN;
CREATE TABLE "StaffRecoveryCode" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "smsCodeMac" CHAR(64) NOT NULL,
  "emailCodeMac" CHAR(64),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffRecoveryCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT staff_recovery_mac CHECK ("smsCodeMac" ~ '^[0-9a-f]{64}$' AND ("emailCodeMac" IS NULL OR "emailCodeMac" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT staff_recovery_attempts CHECK ("attempts" BETWEEN 0 AND 5),
  CONSTRAINT staff_recovery_window CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '15 minutes')
);
CREATE INDEX "StaffRecoveryCode_userId_createdAt_idx" ON "StaffRecoveryCode"("userId", "createdAt" DESC);
-- At most one open code per person.
CREATE UNIQUE INDEX staff_recovery_one_open ON "StaffRecoveryCode"("userId") WHERE "consumedAt" IS NULL;
ALTER TABLE "StaffRecoveryCode" ADD CONSTRAINT "StaffRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
