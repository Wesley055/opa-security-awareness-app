import { randomBytes } from "crypto";
import type { PrismaService } from "../../prisma/prisma.service";
import { LocalIdentityCrypto } from "./identity-crypto";
import { ProtectedIdentityService } from "./protected-identity.service";

const tenantId = "tenant-a";
const actor = "actor-a";
const caseReference = "00000000-0000-4000-8000-000000000001";
const context = {
  tenantId,
  subjectUserId: "subject-a",
  sourceId: "source-a",
  kind: "EMAIL" as const,
};

describe("protected identity authorization and audit", () => {
  const crypto = new LocalIdentityCrypto(
    new Map([["e1", randomBytes(32)]]),
    "e1",
    randomBytes(32),
    "h1",
  );
  const tx = {
    identityAccessGrant: { findFirst: jest.fn() },
    protectedIdentifier: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    identityResolutionAudit: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const service = new ProtectedIdentityService(
    prisma as unknown as PrismaService,
    crypto,
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    tx.identityAccessGrant.findFirst.mockResolvedValue({ id: "grant" });
    tx.user.findFirst.mockResolvedValue({ tenantId });
    tx.protectedIdentifier.findFirst.mockResolvedValue({
      id: "record",
      ...context,
      ...(await crypto.seal("person@example.test", context)),
    });
    tx.identityResolutionAudit.create.mockResolvedValue({});
  });
  it("masks the default API output without decrypting", async () => {
    const open = jest.spyOn(crypto, "open");
    expect(await service.readMasked(actor, tenantId, "record")).toEqual({
      id: "record",
      kind: "EMAIL",
      value: "[protected]",
    });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
  it("never releases plaintext when committing the resolution audit fails", async () => {
    prisma.$transaction.mockImplementationOnce(async (fn) => {
      await fn(tx);
      throw new Error("COMMIT_FAILED");
    });
    await expect(service.resolve(actor, tenantId, "record", "SUPPORT_CASE", caseReference))
      .rejects.toThrow("COMMIT_FAILED");
    expect(tx.identityResolutionAudit.create).toHaveBeenCalledTimes(1);
  });

  it("uses only the caller transaction and still requires its resolution grant", async () => {
    tx.identityAccessGrant.findFirst.mockResolvedValueOnce(null);
    await expect(service.resolveInTransaction(tx as never, actor, tenantId, "record", "SUPPORT_CASE", caseReference))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.identityResolutionAudit.create).not.toHaveBeenCalled();
  });

  it("requires explicit grants even for an administrator", async () => {
    tx.identityAccessGrant.findFirst.mockResolvedValue(null);
    await expect(
      service.resolve(
        "admin",
        tenantId,
        "record",
        "SUPPORT_CASE",
        caseReference,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.protectedIdentifier.findFirst).not.toHaveBeenCalled();
    expect(tx.identityResolutionAudit.create).not.toHaveBeenCalled();
  });
  it("scopes both authorization and resource query to the tenant", async () => {
    await service.readMasked(actor, tenantId, "record");
    expect(
      tx.identityAccessGrant.findFirst.mock.calls[0]?.[0].where,
    ).toMatchObject({
      tenantId,
      actorUserId: actor,
      permission: "READ_MASKED",
      revokedAt: null,
    });
    expect(
      tx.protectedIdentifier.findFirst.mock.calls[0]?.[0].where,
    ).toMatchObject({ tenantId, id: "record" });
  });
  it("returns identical missing and unauthorized failures", async () => {
    tx.protectedIdentifier.findFirst.mockResolvedValue(null);
    const absent = await service
      .resolve(actor, tenantId, "missing", "SUPPORT_CASE", caseReference)
      .catch((e: Error) => e.message);
    tx.identityAccessGrant.findFirst.mockResolvedValue(null);
    expect(
      await service
        .resolve(actor, tenantId, "record", "SUPPORT_CASE", caseReference)
        .catch((e: Error) => e.message),
    ).toBe(absent);
  });
  it("records an allowlisted audit before releasing plaintext", async () => {
    expect(
      await service.resolve(
        actor,
        tenantId,
        "record",
        "SUPPORT_CASE",
        caseReference,
      ),
    ).toBe("person@example.test");
    expect(tx.identityResolutionAudit.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        actorUserId: actor,
        identifierId: "record",
        grantId: "grant",
        purpose: "SUPPORT_CASE",
        caseReference,
        encryptionKeyVersion: "e1",
      },
    });
    expect(
      JSON.stringify(tx.identityResolutionAudit.create.mock.calls),
    ).not.toContain("person@example.test");
  });
  it("fails closed when audit persistence fails", async () => {
    tx.identityResolutionAudit.create.mockRejectedValueOnce(
      new Error("database error person@example.test"),
    );
    await expect(
      service.resolve(actor, tenantId, "record", "SUPPORT_CASE", caseReference),
    ).rejects.toThrow("Protected identity operation unavailable.");
  });
  it("does not fall back to a legacy plaintext field on failed decryption", async () => {
    const row = await tx.protectedIdentifier.findFirst();
    tx.protectedIdentifier.findFirst.mockResolvedValue({
      ...row,
      tag: "bad",
      email: "legacy@example.test",
    });
    await expect(
      service.resolve(actor, tenantId, "record", "SUPPORT_CASE", caseReference),
    ).rejects.toThrow("Protected identity operation unavailable.");
  });
  it("does not permit interactive resolution of delivery snapshots", async () => {
    tx.protectedIdentifier.findFirst.mockResolvedValue({
      kind: "INVITATION_SNAPSHOT",
    });
    await expect(
      service.resolve(actor, tenantId, "record", "SUPPORT_CASE", caseReference),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("requires a separate delivery grant", async () => {
    tx.identityAccessGrant.findFirst.mockResolvedValue(null);
    await expect(
      service.resolve(actor, tenantId, "record", "DELIVERY", caseReference),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      tx.identityAccessGrant.findFirst.mock.calls[0]?.[0].where.permission,
    ).toBe("DELIVERY");
  });
  it("does not let an ungranted equality lookup become an oracle", async () => {
    tx.identityAccessGrant.findFirst.mockResolvedValue(null);
    await expect(
      service.lookup(actor, tenantId, "EMAIL", "person@example.test"),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.protectedIdentifier.findMany).not.toHaveBeenCalled();
  });
});
