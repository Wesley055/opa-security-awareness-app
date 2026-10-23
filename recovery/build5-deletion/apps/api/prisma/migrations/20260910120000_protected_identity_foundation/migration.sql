-- CreateEnum
CREATE TYPE "IdentityPermission" AS ENUM ('READ_MASKED', 'WRITE', 'LOOKUP', 'RESOLVE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "ProtectedIdentifierKind" AS ENUM ('EMAIL', 'PHONE', 'NOTIFICATION_SNAPSHOT', 'INVITATION_SNAPSHOT');

-- CreateTable
CREATE TABLE "IdentityAccessGrant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "permission" "IdentityPermission" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "approvedByReference" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtectedIdentifier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subjectUserId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "kind" "ProtectedIdentifierKind" NOT NULL,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "normalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptionKeyVersion" VARCHAR(40) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "nonce" VARCHAR(24) NOT NULL,
    "tag" VARCHAR(24) NOT NULL,
    "lookupDigest" VARCHAR(64),
    "lookupKeyVersion" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtectedIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityResolutionAudit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "identifierId" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "caseReference" UUID NOT NULL,
    "encryptionKeyVersion" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityResolutionAudit_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "IdentityAccessGrant_tenantId_actorUserId_permission_expires_idx" ON "IdentityAccessGrant"("tenantId", "actorUserId", "permission", "expiresAt");

-- CreateIndex
CREATE INDEX "ProtectedIdentifier_tenantId_kind_normalizationVersion_look_idx" ON "ProtectedIdentifier"("tenantId", "kind", "normalizationVersion", "lookupKeyVersion", "lookupDigest");

-- CreateIndex
CREATE UNIQUE INDEX "ProtectedIdentifier_tenantId_subjectUserId_kind_sourceId_key" ON "ProtectedIdentifier"("tenantId", "subjectUserId", "kind", "sourceId");

-- CreateIndex
CREATE INDEX "IdentityResolutionAudit_tenantId_createdAt_idx" ON "IdentityResolutionAudit"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityResolutionAudit_actorUserId_createdAt_idx" ON "IdentityResolutionAudit"("actorUserId", "createdAt");



-- AddForeignKey
ALTER TABLE "IdentityAccessGrant" ADD CONSTRAINT "IdentityAccessGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityAccessGrant" ADD CONSTRAINT "IdentityAccessGrant_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtectedIdentifier" ADD CONSTRAINT "ProtectedIdentifier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProtectedIdentifier" ADD CONSTRAINT "ProtectedIdentifier_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Paired lookup metadata and explicit supported envelope format; legacy tables are untouched.
ALTER TABLE "ProtectedIdentifier" ADD CONSTRAINT "protected_identifier_envelope_check"
CHECK ("formatVersion" = 1 AND "normalizationVersion" = 1 AND length("nonce") = 16 AND length("tag") = 24
  AND "encryptionKeyVersion" ~ '^[a-zA-Z0-9_-]{1,40}$'
  AND (("kind" IN ('EMAIL', 'PHONE') AND "lookupDigest" ~ '^[0-9a-f]{64}$' AND "lookupDigest" IS NOT NULL
    AND "lookupKeyVersion" IS NOT NULL AND "lookupKeyVersion" ~ '^[a-zA-Z0-9_-]{1,40}$')
    OR ("kind" IN ('NOTIFICATION_SNAPSHOT', 'INVITATION_SNAPSHOT') AND "lookupDigest" IS NULL AND "lookupKeyVersion" IS NULL)));

-- Normal application UPDATE/DELETE cannot erase resolution history. Database owners can still bypass this.
CREATE FUNCTION identity_resolution_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Identity resolution audit is append-only';
END;
$$;
CREATE TRIGGER identity_resolution_audit_append_only
BEFORE UPDATE OR DELETE ON "IdentityResolutionAudit"
FOR EACH ROW EXECUTE FUNCTION identity_resolution_audit_append_only();
