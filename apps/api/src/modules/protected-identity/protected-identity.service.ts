import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  IdentityPermission,
  Prisma,
  ProtectedIdentifier,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  IdentityCrypto,
  maskedIdentity,
  normalizeIdentifier,
} from "./identity-crypto";
import type { CryptoContext, SealedValue } from "./identity-crypto";

export type ResolutionPurpose =
  "SUPPORT_CASE" | "ACCOUNT_RECOVERY" | "DELIVERY";
const unavailable = () =>
  new NotFoundException("Protected identity not found.");

@Injectable()
export class ProtectedIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: IdentityCrypto,
  ) {}

  async actorScope(tx: Prisma.TransactionClient, actorUserId: string): Promise<string> {
    const actor = await tx.user.findFirst({ where: { id: actorUserId, isActive: true, accountStatus: "ACTIVE", facility: { isActive: true } }, select: { facilityId: true } });
    if (!actor?.facilityId) throw unavailable();
    return actor.facilityId;
  }

  async authorize(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorUserId: string,
    permission: IdentityPermission,
  ) {
    const grant = await tx.identityAccessGrant.findFirst({
      where: {
        tenantId,
        actorUserId,
        permission,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        tenant: { isActive: true },
        actor: { isActive: true, accountStatus: "ACTIVE", facilityId: tenantId, ...(permission === "DELIVERY" ? {} : { role: { in: ["ADMIN", "FACILITY_ADMIN", "FACILITY_OPERATOR"] } }) },
      },
      select: { id: true },
    });
    if (!grant) throw unavailable();
    return grant;
  }

  private async find(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ) {
    const row = await tx.protectedIdentifier.findFirst({
      where: {
        id,
        tenantId,
        tenant: { isActive: true }, subject: { facilityId: tenantId, isActive: true },
      },
    });
    if (!row) throw unavailable();
    return row;
  }

  async readMasked(actorUserId: string, tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorize(tx, tenantId, actorUserId, "READ_MASKED");
      return maskedIdentity(await this.find(tx, tenantId, id));
    });
  }

  /** Internal ingestion boundary. No public create/grant endpoint. Duplicate sources are immutable. */
  async protect(
    actorUserId: string,
    context: CryptoContext,
    plaintext: string,
  ) {
    return this.prisma.$transaction((tx) =>
      this.protectInTransaction(tx, actorUserId, context, plaintext),
    );
  }

  /** Internal adapter for atomic outbox cutover. Always enforces WRITE authority. */
  async protectInTransaction(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    context: CryptoContext,
    plaintext: string,
  ) {
    await this.authorize(tx, context.tenantId, actorUserId, "WRITE");
    const membership = await tx.user.findFirst({
      where: {
        facilityId: context.tenantId,
        id: context.subjectUserId,
        isActive: true,
        facility: { isActive: true },
      },
    });
    if (!membership) throw unavailable();
    try {
      const isIdentifier = context.kind === "EMAIL" || context.kind === "PHONE";
      const value = isIdentifier
        ? normalizeIdentifier(context.kind, plaintext)
        : plaintext;
      const sealed = await this.crypto.seal(value, context);
      const lookup = isIdentifier
        ? await this.crypto.lookup(value, context)
        : null;
      const row = await tx.protectedIdentifier.create({
        data: {
          ...context,
          ...sealed,
          lookupDigest: lookup?.digest,
          lookupKeyVersion: lookup?.lookupKeyVersion,
        },
      });
      // Verify the actual persisted representation before a caller can erase a legacy source.
      // This compares caller-supplied input; it does not disclose stored plaintext to the caller.
      if (
        (await this.crypto.open(this.envelope(row), context)) !== value ||
        row.lookupDigest !== (lookup?.digest ?? null) ||
        row.lookupKeyVersion !== (lookup?.lookupKeyVersion ?? null)
      ) {
        throw new Error("Protected identity verification failed.");
      }
      return maskedIdentity(row);
    } catch {
      // Never expose Prisma errors (they can embed parameters), provider errors, or duplicate-source details.
      throw new ServiceUnavailableException(
        "Protected identity operation unavailable.",
      );
    }
  }

  /** Equality lookup requires an independent grant and always returns a masked projection. Not an auth endpoint. */
  async lookup(
    actorUserId: string,
    tenantId: string,
    kind: "EMAIL" | "PHONE",
    plaintext: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorize(tx, tenantId, actorUserId, "LOOKUP");
      let key;
      try {
        key = await this.crypto.lookup(plaintext, { tenantId, kind });
      } catch {
        throw unavailable();
      }
      const rows = await tx.protectedIdentifier.findMany({
        where: {
          tenantId,
          kind,
          normalizationVersion: 1,
          lookupKeyVersion: key.lookupKeyVersion,
          lookupDigest: key.digest,
          tenant: { isActive: true }, subject: { facilityId: tenantId, isActive: true },
        },
        take: 100,
      });
      return rows.map(maskedIdentity);
    });
  }

  async resolve(
    actorUserId: string,
    tenantId: string,
    id: string,
    purpose: ResolutionPurpose,
    caseReference: string,
    expected?: CryptoContext,
  ) {
    if (
      !["SUPPORT_CASE", "ACCOUNT_RECOVERY", "DELIVERY"].includes(purpose) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        caseReference,
      )
    )
      throw unavailable();
    // The transaction must COMMIT the audit before its promise releases any plaintext.
    return this.prisma.$transaction(async (tx) => {
      const grant = await this.authorize(
        tx,
        tenantId,
        actorUserId,
        purpose === "DELIVERY" ? "DELIVERY" : "RESOLVE",
      );
      const row = await this.find(tx, tenantId, id);
      if (
        expected &&
        (row.tenantId !== expected.tenantId ||
          row.subjectUserId !== expected.subjectUserId ||
          row.sourceId !== expected.sourceId ||
          row.kind !== expected.kind)
      )
        throw unavailable();
      const snapshot =
        row.kind === "INVITATION_SNAPSHOT" ||
        row.kind === "NOTIFICATION_SNAPSHOT";
      if (snapshot !== (purpose === "DELIVERY")) throw unavailable();
      try {
        const plaintext = await this.crypto.open(this.envelope(row), row);
        await tx.identityResolutionAudit.create({
          data: {
            tenantId,
            actorUserId,
            identifierId: row.id,
            grantId: grant.id,
            purpose,
            caseReference,
            encryptionKeyVersion: row.encryptionKeyVersion,
          },
        });
        return plaintext;
      } catch {
        throw new ServiceUnavailableException(
          "Protected identity operation unavailable.",
        );
      }
    });
  }

  private envelope(row: ProtectedIdentifier): SealedValue {
    if (row.formatVersion !== 1 || row.normalizationVersion !== 1)
      throw new ServiceUnavailableException(
        "Protected identity operation unavailable.",
      );
    return { ...row, formatVersion: 1, normalizationVersion: 1 };
  }
}
