-- CreateTable
CREATE TABLE "SsoConfiguration" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "providerType" VARCHAR(8) NOT NULL,
    "issuer" VARCHAR(2048) NOT NULL,
    "audience" VARCHAR(2048) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trust" JSONB NOT NULL,
    "secret" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoExternalIdentity" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "identityDigest" VARCHAR(64) NOT NULL,
    "identityCiphertext" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),

    CONSTRAINT "SsoExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoTransaction" (
    "id" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "configurationRevision" INTEGER NOT NULL,
    "purpose" VARCHAR(8) NOT NULL,
    "stateHash" VARCHAR(64) NOT NULL,
    "browserBindingHash" VARCHAR(64) NOT NULL,
    "nonceHash" VARCHAR(64),
    "nonce" JSONB,
    "pkceVerifier" JSONB,
    "requestId" VARCHAR(128),
    "targetUserId" UUID,
    "credentialVersion" INTEGER,
    "reauthenticatedAt" TIMESTAMP(3),
    "linkSessionHash" VARCHAR(64),
    "verifiedProof" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoReplay" (
    "key" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoReplay_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SsoAuditEvent" (
    "id" UUID NOT NULL,
    "facilityId" UUID,
    "configurationId" UUID,
    "actorUserId" UUID,
    "targetUserId" UUID,
    "mappingId" UUID,
    "transactionId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(8) NOT NULL,
    "configurationRevision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoConfiguration_facilityId_enabled_idx" ON "SsoConfiguration"("facilityId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SsoConfiguration_id_facilityId_key" ON "SsoConfiguration"("id", "facilityId");

-- CreateIndex
CREATE INDEX "SsoExternalIdentity_userId_enabled_idx" ON "SsoExternalIdentity"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SsoExternalIdentity_configurationId_identityDigest_key" ON "SsoExternalIdentity"("configurationId", "identityDigest");

-- CreateIndex
CREATE UNIQUE INDEX "SsoTransaction_stateHash_key" ON "SsoTransaction"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "SsoTransaction_requestId_key" ON "SsoTransaction"("requestId");

-- CreateIndex
CREATE INDEX "SsoTransaction_expiresAt_idx" ON "SsoTransaction"("expiresAt");

-- CreateIndex
CREATE INDEX "SsoReplay_expiresAt_idx" ON "SsoReplay"("expiresAt");

-- CreateIndex
CREATE INDEX "SsoAuditEvent_facilityId_createdAt_idx" ON "SsoAuditEvent"("facilityId", "createdAt");

-- AddForeignKey
ALTER TABLE "SsoConfiguration" ADD CONSTRAINT "SsoConfiguration_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoExternalIdentity" ADD CONSTRAINT "SsoExternalIdentity_configurationId_facilityId_fkey" FOREIGN KEY ("configurationId", "facilityId") REFERENCES "SsoConfiguration"("id", "facilityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoExternalIdentity" ADD CONSTRAINT "SsoExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoTransaction" ADD CONSTRAINT "SsoTransaction_configurationId_facilityId_fkey" FOREIGN KEY ("configurationId", "facilityId") REFERENCES "SsoConfiguration"("id", "facilityId") ON DELETE RESTRICT ON UPDATE CASCADE;
