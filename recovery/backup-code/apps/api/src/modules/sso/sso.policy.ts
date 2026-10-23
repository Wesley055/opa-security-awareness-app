import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import type {
  ExternalIdentityKey,
  ExternalIdentityMapping,
  LoginTransaction,
  MembershipAuthorization,
  SsoConfiguration,
  VerifiedAssertion,
} from './sso.contracts';

export const SSO_FAILED = 'Institutional sign-in could not be completed.';
const MAX_TRANSACTION_AGE = 5 * 60_000;
const MAX_ASSERTION_AGE = 5 * 60_000;
const MAX_CLOCK_SKEW = 60_000;
export const PERSISTENT_NAME_ID =
  'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';

/** Deliberately carries no provider error or cause. HTTP adapter must map every
 * failure to the same status/body and use an opaque correlation ID for support. */
export class SsoDenied extends UnauthorizedException {
  constructor() {
    super(SSO_FAILED);
    this.name = 'SsoDenied';
  }
}
function requireCondition(value: unknown): asserts value {
  if (!value) throw new SsoDenied();
}
function bounded(value: string, max = 2048): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function matchesHash(raw: string, hash: string): boolean {
  return (
    bounded(raw) &&
    /^[a-f0-9]{64}$/.test(hash) &&
    timingSafeEqual(Buffer.from(digest(raw), 'hex'), Buffer.from(hash, 'hex'))
  );
}
export function createCorrelationMaterial() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    browserBinding: randomBytes(32).toString('base64url'),
    pkceVerifier: verifier,
    pkceChallenge: createHash('sha256').update(verifier).digest('base64url'),
    pkceMethod: 'S256' as const,
  };
}
function httpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

/** Structural policy only. Network allowlisting/SSRF and key trust belong to
 * the metadata registry. A syntactically HTTPS URL is NOT safe to fetch. */
export function validateConfiguration(config: SsoConfiguration): void {
  requireCondition(bounded(config.id) && bounded(config.organizationId));
  requireCondition(
    Number.isSafeInteger(config.revision) && config.revision > 0,
  );
  requireCondition(
    config.providerType === 'OIDC' || config.providerType === 'SAML2',
  );
  requireCondition(bounded(config.issuer) && bounded(config.audience));
  requireCondition(
    httpsUrl(config.callbackUrl) && bounded(config.trustMetadataReference),
  );
  if (config.providerType === 'OIDC') requireCondition(httpsUrl(config.issuer));
  requireCondition(config.jit?.enabled === false);
  if (config.secret) {
    requireCondition(
      (config.secret.kind === 'vault' &&
        bounded(config.secret.reference) &&
        bounded(config.secret.version)) ||
        (config.secret.kind === 'envelope' &&
          bounded(config.secret.ciphertext, 65536) &&
          bounded(config.secret.keyReference) &&
          bounded(config.secret.keyVersion)),
    );
  }
}

/** Use before any provider exchange. Transaction is loaded from trusted storage,
 * and the raw browser binding comes from a dedicated secure HttpOnly cookie. */
export function validateCallbackBinding(
  config: SsoConfiguration,
  tx: LoginTransaction,
  input: { organizationId: string; state: string; browserBinding: string },
  now: number,
): void {
  validateConfiguration(config);
  requireCondition(config.enabled === true && Number.isFinite(now));
  requireCondition(
    input.organizationId === config.organizationId &&
      tx.organizationId === config.organizationId &&
      tx.configurationId === config.id &&
      tx.configurationRevision === config.revision,
  );
  requireCondition(
    Number.isFinite(tx.createdAt) &&
      Number.isFinite(tx.expiresAt) &&
      tx.createdAt <= now &&
      tx.expiresAt > now &&
      tx.expiresAt > tx.createdAt &&
      tx.expiresAt - tx.createdAt <= MAX_TRANSACTION_AGE,
  );
  requireCondition(
    matchesHash(input.state, tx.stateHash) &&
      matchesHash(input.browserBinding, tx.browserBindingHash),
  );
  requireCondition(
    tx.purpose === 'login' ||
      (tx.purpose === 'link' && bounded(tx.targetUserId ?? '')),
  );
  if (config.providerType === 'OIDC') {
    requireCondition(
      !!tx.pkceVerifier && /^[a-f0-9]{64}$/.test(tx.nonceHash ?? ''),
    );
  } else {
    requireCondition(bounded(tx.requestId ?? ''));
  }
}

/** Additional policy over VERIFIED assertions, not a JWT/XML verifier.
 * No clock-skew extension of expiry: reject at the exact expiration boundary. */
export function validateAssertion(
  config: SsoConfiguration,
  tx: LoginTransaction,
  assertion: VerifiedAssertion,
  now: number,
): ExternalIdentityKey {
  validateConfiguration(config);
  requireCondition(config.enabled === true && Number.isFinite(now));
  requireCondition(
    tx.organizationId === config.organizationId &&
      tx.configurationId === config.id &&
      tx.configurationRevision === config.revision,
  );
  requireCondition(
    assertion.providerType === config.providerType &&
      assertion.issuer === config.issuer,
  );
  requireCondition(bounded(assertion.subject) && bounded(assertion.responseId));
  requireCondition(
    Array.isArray(assertion.audiences) &&
      assertion.audiences.length > 0 &&
      assertion.audiences.length <= 20 &&
      assertion.audiences.every((audience) => bounded(audience)) &&
      assertion.audiences.includes(config.audience),
  );
  requireCondition(
    [assertion.issuedAt, assertion.notBefore, assertion.expiresAt].every(
      Number.isFinite,
    ),
  );
  requireCondition(
    assertion.issuedAt <= now + MAX_CLOCK_SKEW &&
      assertion.issuedAt >= now - MAX_ASSERTION_AGE &&
      assertion.notBefore <= now + MAX_CLOCK_SKEW &&
      assertion.expiresAt > now &&
      assertion.expiresAt > assertion.notBefore &&
      assertion.expiresAt > assertion.issuedAt &&
      assertion.expiresAt - assertion.issuedAt <= MAX_ASSERTION_AGE,
  );
  if (config.providerType === 'OIDC') {
    requireCondition(assertion.subjectFormat === 'sub');
    requireCondition(matchesHash(assertion.nonce ?? '', tx.nonceHash ?? ''));
    requireCondition(
      (assertion.audiences.length === 1 ||
        assertion.authorizedParty === config.audience) &&
        (assertion.authorizedParty === undefined ||
          assertion.authorizedParty === config.audience),
    );
  } else {
    requireCondition(
      assertion.subjectFormat === PERSISTENT_NAME_ID &&
        bounded(tx.requestId ?? '') &&
        assertion.inResponseTo === tx.requestId &&
        assertion.recipient === config.callbackUrl,
    );
  }
  return {
    organizationId: config.organizationId,
    configurationId: config.id,
    providerType: config.providerType,
    issuer: assertion.issuer,
    subject: assertion.subject,
    subjectFormat: assertion.subjectFormat,
  };
}

/** JSON tuple encoding avoids separator collisions and preserves case/Unicode. */
export function identityKey(identity: ExternalIdentityKey): string {
  return JSON.stringify([
    identity.organizationId,
    identity.configurationId,
    identity.providerType,
    identity.issuer,
    identity.subjectFormat,
    identity.subject,
  ]);
}
/** Replay uniqueness deliberately spans configurations and organizations for
 * the same issuer. Store only a hash, retain until assertion expiry plus skew. */
export function replayKey(assertion: VerifiedAssertion): string {
  return digest(
    JSON.stringify([
      assertion.providerType,
      assertion.issuer,
      assertion.responseId,
    ]),
  );
}

/** Called under the completion port's transaction, after exact mapping lookup.
 * No JIT side effect, no email fallback, no platform privilege from tenant SSO.
 * Explicit platform admins use the independent local platform ceremony. */
export function authorizeMappedIdentity(
  identity: ExternalIdentityKey,
  mapping: ExternalIdentityMapping | null,
  auth: MembershipAuthorization | null,
): { userId: string; credentialVersion: number; opaRole: string } {
  requireCondition(
    mapping &&
      mapping.enabled === true &&
      identityKey(mapping) === identityKey(identity),
  );
  requireCondition(
    auth &&
      auth.userId === mapping.userId &&
      auth.organizationId === identity.organizationId,
  );
  requireCondition(
    auth.userActive === true &&
      auth.accountActivated === true &&
      auth.organizationActive === true &&
      auth.membershipActive === true &&
      auth.operatorSuspended === false,
  );
  // Baseline ADMIN grants platform authority. Do not mint it via tenant SSO.
  requireCondition(
    auth.platformSuperAdmin === false &&
      ['USER', 'RESPONDER', 'FACILITY_ADMIN', 'FACILITY_OPERATOR'].includes(
        auth.opaRole,
      ),
  );
  requireCondition(
    Number.isSafeInteger(auth.credentialVersion) && auth.credentialVersion >= 0,
  );
  return {
    userId: auth.userId,
    credentialVersion: auth.credentialVersion,
    opaRole: auth.opaRole,
  };
}

export interface LinkProof {
  userId: string;
  transactionId: string;
  identityKey: string;
  credentialVersion: number;
  authenticatedAt: number;
  expiresAt: number;
}
/** Proof object is resolved by the trusted local reauthentication service,
 * never deserialized from a request. Consumption and unique insert are atomic. */
export function authorizeLink(
  identity: ExternalIdentityKey,
  tx: LoginTransaction,
  proof: LinkProof,
  auth: MembershipAuthorization,
  existing: ExternalIdentityMapping | null,
  now: number,
): void {
  requireCondition(
    Number.isFinite(now) &&
      tx.purpose === 'link' &&
      tx.targetUserId === auth.userId &&
      tx.organizationId === identity.organizationId &&
      tx.configurationId === identity.configurationId &&
      tx.expiresAt > now &&
      tx.createdAt <= now &&
      tx.expiresAt - tx.createdAt <= MAX_TRANSACTION_AGE,
  );
  requireCondition(existing === null); // No idempotent reassignment or upsert.
  requireCondition(
    proof.userId === auth.userId &&
      proof.transactionId === tx.id &&
      proof.identityKey === identityKey(identity) &&
      proof.credentialVersion === auth.credentialVersion &&
      Number.isFinite(proof.authenticatedAt) &&
      Number.isFinite(proof.expiresAt) &&
      proof.authenticatedAt <= now &&
      proof.authenticatedAt >= now - MAX_TRANSACTION_AGE &&
      proof.expiresAt > now &&
      proof.expiresAt - proof.authenticatedAt <= MAX_TRANSACTION_AGE,
  );
  authorizeMappedIdentity(
    identity,
    { ...identity, id: 'pending', userId: auth.userId, enabled: true },
    auth,
  );
}
