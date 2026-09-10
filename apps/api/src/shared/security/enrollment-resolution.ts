import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { revealIdentity } from './enrollment-identity';

/** Internal verified-workflow resolution. The caller must commit this transaction before returning or dispatching. */
export async function resolveEnrollmentIdentity<T>(
  tx: Prisma.TransactionClient,
  config: ConfigService,
  ciphertext: string,
  authority: {
    sourceId: string;
    facilityId?: string | null;
    actorUserId?: string | null;
    purpose: 'ENROLLMENT_VERIFY' | 'ENROLLMENT_ACCEPT' | 'ENROLLMENT_DELIVERY' | 'PASSWORD_RESET_DELIVERY';
  },
): Promise<T> {
  const plaintext = revealIdentity<T>(config, ciphertext);
  await tx.identityResolutionAudit.create({ data: {
    sourceType: authority.purpose === 'PASSWORD_RESET_DELIVERY' ? 'PASSWORD_RESET_REQUEST' : 'ENROLLMENT_REQUEST',
    identifierId: authority.sourceId,
    caseReference: authority.sourceId,
    tenantId: authority.facilityId ?? null,
    actorUserId: authority.actorUserId ?? null,
    grantId: null,
    purpose: authority.purpose,
    encryptionKeyVersion: 'enrollment-v1',
  } });
  return plaintext;
}
