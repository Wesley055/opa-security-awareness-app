/**
 * Enterprise SSO protocol and policy boundary. SsoService binds these
 * contracts to authoritative Facility/User persistence and OPA sessions.
 * These are internal server contracts, NEVER request DTOs.
 */
export type ProviderType = 'OIDC' | 'SAML2';
export type SecretReference =
  | { kind: 'vault'; reference: string; version: string }
  | {
      kind: 'envelope';
      ciphertext: string;
      keyReference: string;
      keyVersion: string;
    };

export interface SsoConfiguration {
  id: string;
  organizationId: string; // The existing authoritative Facility.id.
  revision: number;
  enabled: boolean;
  providerType: ProviderType;
  issuer: string; // Exact OIDC issuer or SAML IdP entityID; never normalize.
  audience: string; // OIDC client_id or SAML SP entityID.
  callbackUrl: string; // Registered server-owned HTTPS destination.
  secret?: SecretReference;
  trust: {
    discoveryUrl?: string;
    authorizationEndpoint: string;
    tokenEndpoint?: string;
    jwksUri?: string;
    certificates?: string[];
  };
  trustMetadataReference: string; // Approved JWKS/metadata/certificate registry entry.
  jit: { enabled: false };
}

/** Exact tuple; no email, domain, phone number, role or display name participates. */
export interface ExternalIdentityKey {
  organizationId: string;
  configurationId: string;
  providerType: ProviderType;
  issuer: string;
  subject: string;
  subjectFormat: string; // OIDC: "sub"; SAML: approved persistent NameID format.
}
export interface ExternalIdentityMapping extends ExternalIdentityKey {
  id: string;
  userId: string; // Explicit FK to existing User; immutable after linking.
  enabled: boolean;
}

/** Projection from current authoritative account/membership state, under lock. */
export interface MembershipAuthorization {
  userId: string;
  organizationId: string;
  userActive: boolean;
  accountActivated: boolean;
  organizationActive: boolean;
  membershipActive: boolean;
  operatorSuspended: boolean;
  credentialVersion: number;
  opaRole: string; // Database only. Never supplied by an IdP.
  platformSuperAdmin: boolean; // Explicit platform authority, not an ADMIN string.
}

export interface LoginTransaction {
  id: string;
  organizationId: string;
  configurationId: string;
  configurationRevision: number;
  purpose: 'login' | 'link';
  targetUserId?: string;
  stateHash: string;
  browserBindingHash: string;
  nonceHash?: string;
  nonce?: SecretReference;
  pkceVerifier?: SecretReference;
  requestId?: string;
  createdAt: number; // UTC epoch milliseconds.
  expiresAt: number;
}

/**
 * Produced ONLY by a cryptographic protocol adapter after signature, algorithm,
 * key trust, parsing and protocol checks. Never accept a client-supplied object
 * of this type. TypeScript is not a cryptographic trust boundary.
 */
export interface VerifiedAssertion {
  providerType: ProviderType;
  issuer: string;
  subject: string;
  subjectFormat: string;
  audiences: readonly string[];
  authorizedParty?: string;
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
  nonce?: string;
  responseId: string; // Adapter-derived replay identifier, not an email.
  samlResponseId?: string;
  inResponseTo?: string;
  recipient?: string;
}

export interface ProtocolVerifier {
  /** OIDC: code exchange with S256 verifier, then verify ID token via pinned
   * issuer keys. SAML: bounded XML, no DTD/entities, trusted signed assertion,
   * response binding/status/signature, wrapping defence and time validation.
   * Throw on all errors; never return decoded-but-unverified claims. */
  verify(
    configuration: SsoConfiguration,
    transaction: LoginTransaction,
    rawResponse: unknown,
  ): Promise<VerifiedAssertion>;
}

export type SsoAuditAction =
  | 'AUTHENTICATION_SUCCEEDED'
  | 'AUTHENTICATION_FAILED'
  | 'IDENTITY_LINKED'
  | 'IDENTITY_UNLINKED'
  | 'CONFIGURATION_CREATED'
  | 'CONFIGURATION_UPDATED'
  | 'CONFIGURATION_DISABLED'
  | 'CONFIGURATION_CHANGE_DENIED'
  | 'IDENTITY_LINK_FAILED'
  | 'IDENTITY_UNLINK_DENIED'
  | 'SESSIONS_REVOKED';
export interface SsoAuditEvent {
  action: SsoAuditAction;
  organizationId: string;
  configurationId: string;
  correlationId: string;
  actorUserId?: string;
  targetUserId?: string;
  mappingId?: string;
  configurationRevision?: number;
  occurredAt: number;
  outcome: 'success' | 'denied';
  // No arbitrary payload, assertion, subject, email, token or provider error.
}

/**
 * Implement using the SAME database transaction / per-user lock domain as
 * account and membership lifecycle changes. A durable unique replay insert
 * and conditional transaction consumption must fail on duplicates even across
 * processes. Re-read config revision, mapping, user and membership under lock.
 * Run the policy checks before issuing an existing OPA session; success audit
 * and mapping/link mutations must commit atomically. Never sign IdP roles.
 *
 * Interface only: no in-memory production fallback or competing Prisma model.
 */
export interface SsoCompletionPort<Session> {
  complete(input: {
    transactionId: string;
    expectedConfigurationRevision: number;
    identity: ExternalIdentityKey;
    replayKey: string;
    replayExpiresAt: number;
    correlationId: string;
  }): Promise<Session>;
}

export interface SsoLifecyclePort {
  /** Both proofs must be server-side, recent, single-use and bound to the
   * session, credentialVersion, target user, transaction and exact identity.
   * Recheck active membership; unique insert only, NEVER upsert/reassign. */
  link(input: {
    transactionId: string;
    localReauthenticationProofId: string;
    verifiedExternalProofId: string;
    correlationId: string;
  }): Promise<void>;
  /** Reauthenticate, retain an independent recovery method, disable mapping,
   * revoke affected sessions and append audit atomically. */
  unlink(input: {
    mappingId: string;
    localReauthenticationProofId: string;
    correlationId: string;
  }): Promise<void>;
  /** Server-authorized org config permission; explicit platform override only.
   * Verify org ownership, increment revision, invalidate pending transactions
   * and sessions as policy requires, preserve break-glass access, append audit. */
  saveConfiguration(input: {
    configuration: SsoConfiguration;
    expectedRevision: number;
    actorUserId: string;
    authorizationProofId: string;
    correlationId: string;
  }): Promise<void>;
}
