import { createHash } from 'crypto';
import type {
  ExternalIdentityMapping,
  LoginTransaction,
  MembershipAuthorization,
  SsoConfiguration,
  VerifiedAssertion,
} from './sso.contracts';
import { completeSsoLogin } from './sso.callback';
import {
  authorizeLink,
  authorizeMappedIdentity,
  createCorrelationMaterial,
  digest,
  identityKey,
  PERSISTENT_NAME_ID,
  replayKey,
  SSO_FAILED,
  validateAssertion,
  validateCallbackBinding,
  validateConfiguration,
} from './sso.policy';

const now = 1_800_000_000_000;
function fixture() {
  const config: SsoConfiguration = {
    id: 'config-a',
    organizationId: 'org-a',
    revision: 1,
    enabled: true,
    providerType: 'OIDC',
    issuer: 'https://idp.example.test/tenant-a',
    audience: 'opa-client',
    callbackUrl: 'https://opa.example.test/sso/callback',
    trustMetadataReference: 'registry-key-a',
    jit: { enabled: false },
    trust: { authorizationEndpoint: 'https://idp.example.test/authorize' },
  };
  const tx: LoginTransaction = {
    id: 'tx-a',
    organizationId: 'org-a',
    configurationId: 'config-a',
    configurationRevision: 1,
    purpose: 'login',
    stateHash: digest('state'),
    browserBindingHash: digest('browser'),
    nonceHash: digest('nonce'),
    pkceVerifier: { kind: 'vault', reference: 'transaction-key', version: '1' },
    createdAt: now - 1000,
    expiresAt: now + 60_000,
  };
  const assertion: VerifiedAssertion = {
    providerType: 'OIDC',
    issuer: config.issuer,
    subject: 'subject-a',
    subjectFormat: 'sub',
    audiences: [config.audience],
    issuedAt: now - 1000,
    notBefore: now - 1000,
    expiresAt: now + 60_000,
    nonce: 'nonce',
    responseId: 'assertion-a',
  };
  const identity = validateAssertion(config, tx, assertion, now);
  const mapping: ExternalIdentityMapping = {
    ...identity,
    id: 'map-a',
    userId: 'user-a',
    enabled: true,
  };
  const auth: MembershipAuthorization = {
    userId: 'user-a',
    organizationId: 'org-a',
    userActive: true,
    accountActivated: true,
    organizationActive: true,
    membershipActive: true,
    operatorSuspended: false,
    credentialVersion: 3,
    opaRole: 'FACILITY_OPERATOR',
    platformSuperAdmin: false,
  };
  const input = {
    organizationId: 'org-a',
    state: 'state',
    browserBinding: 'browser',
    rawResponse: 'opaque-response',
    correlationId: 'correlation-a',
  };
  return { config, tx, assertion, identity, mapping, auth, input };
}
describe('SSO callback validation foundation', () => {
  it('creates independent unpredictable state, nonce and S256 PKCE', () => {
    const a = createCorrelationMaterial(),
      b = createCorrelationMaterial();
    for (const key of [
      'state',
      'nonce',
      'browserBinding',
      'pkceVerifier',
    ] as const) {
      expect(a[key]).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(a[key]).not.toBe(b[key]);
    }
    expect(
      new Set([a.state, a.nonce, a.browserBinding, a.pkceVerifier]).size,
    ).toBe(4);
    expect(a.pkceChallenge).toBe(
      createHash('sha256').update(a.pkceVerifier).digest('base64url'),
    );
    expect(a.pkceMethod).toBe('S256');
  });
  it.each([
    ['wrong tenant', { organizationId: 'org-b' }],
    ['state mismatch', { state: 'forged' }],
    ['browser CSRF mismatch', { browserBinding: 'forged' }],
  ])('rejects %s', (_name, changes) => {
    const f = fixture();
    expect(() =>
      validateCallbackBinding(f.config, f.tx, { ...f.input, ...changes }, now),
    ).toThrow(SSO_FAILED);
  });
  it.each([
    ['expired transaction', { expiresAt: now }],
    ['future transaction', { createdAt: now + 1 }],
    ['configuration swap', { configurationId: 'config-b' }],
    ['configuration revision change', { configurationRevision: 2 }],
    ['tenant substitution', { organizationId: 'org-b' }],
    ['missing PKCE', { pkceVerifier: undefined }],
    ['missing nonce', { nonceHash: undefined }],
    ['unbounded transaction', { expiresAt: now + 600_000 }],
  ])('rejects %s', (_name, changes) => {
    const f = fixture();
    expect(() =>
      validateCallbackBinding(f.config, { ...f.tx, ...changes }, f.input, now),
    ).toThrow(SSO_FAILED);
  });
  it.each([
    ['issuer mismatch', { issuer: 'https://idp.example.test/tenant-b' }],
    ['issuer normalization', { issuer: 'https://idp.example.test/tenant-a/' }],
    ['wrong audience', { audiences: ['another-client'] }],
    ['empty audience', { audiences: [] }],
    ['multi audience without azp', { audiences: ['opa-client', 'other'] }],
    ['wrong azp', { authorizedParty: 'other' }],
    ['nonce mismatch', { nonce: 'forged' }],
    ['missing nonce', { nonce: undefined }],
    ['empty subject', { subject: '' }],
    ['protocol substitution', { providerType: 'SAML2' as const }],
    ['expired assertion', { expiresAt: now }],
    ['future assertion', { notBefore: now + 120_000 }],
    ['old assertion', { issuedAt: now - 600_000 }],
    ['NaN expiry', { expiresAt: NaN }],
    ['infinite expiry', { expiresAt: Infinity }],
    ['unbounded expiry', { expiresAt: now + 600_000 }],
  ])('rejects %s', (_name, changes) => {
    const f = fixture();
    expect(() =>
      validateAssertion(f.config, f.tx, { ...f.assertion, ...changes }, now),
    ).toThrow(SSO_FAILED);
  });
  it('allows multiple OIDC audiences only with exact authorized party', () => {
    const f = fixture();
    expect(
      validateAssertion(
        f.config,
        f.tx,
        {
          ...f.assertion,
          audiences: ['opa-client', 'other'],
          authorizedParty: 'opa-client',
        },
        now,
      ),
    ).toEqual(f.identity);
  });
  it('rejects disabled configuration', () => {
    const f = fixture();
    expect(() =>
      validateCallbackBinding(
        { ...f.config, enabled: false },
        f.tx,
        f.input,
        now,
      ),
    ).toThrow(SSO_FAILED);
  });
  it('rejects all JIT configurations, including an enrollment reference', () => {
    const f = fixture();
    expect(() =>
      validateConfiguration({ ...f.config, jit: { enabled: true } as never }),
    ).toThrow(SSO_FAILED);
    expect(() =>
      validateConfiguration({
        ...f.config,
        jit: { enabled: true, enrollmentPolicyReference: 'policy-a' } as never,
      }),
    ).toThrow(SSO_FAILED);
  });
  it('rejects insecure callback and issuer URLs', () => {
    const f = fixture();
    for (const value of [
      'http://example.test',
      'https://user:pass@example.test',
      'https://example.test/#token',
    ]) {
      expect(() =>
        validateConfiguration({ ...f.config, issuer: value }),
      ).toThrow(SSO_FAILED);
      expect(() =>
        validateConfiguration({ ...f.config, callbackUrl: value }),
      ).toThrow(SSO_FAILED);
    }
  });
});
describe('SAML verified assertion policy', () => {
  function saml() {
    const f = fixture();
    f.config.providerType = 'SAML2';
    f.config.issuer = 'urn:institution:idp';
    f.tx.requestId = 'request-a';
    Object.assign(f.assertion, {
      providerType: 'SAML2',
      issuer: f.config.issuer,
      subjectFormat: PERSISTENT_NAME_ID,
      inResponseTo: 'request-a',
      recipient: f.config.callbackUrl,
    });
    return f;
  }
  it('accepts solicited persistent NameID with matching recipient and request', () => {
    const f = saml();
    expect(validateAssertion(f.config, f.tx, f.assertion, now).subject).toBe(
      'subject-a',
    );
  });
  it.each([
    ['unsolicited response', { inResponseTo: undefined }],
    ['wrong request', { inResponseTo: 'request-b' }],
    ['wrong ACS recipient', { recipient: 'https://evil.example.test' }],
    [
      'email NameID',
      {
        subjectFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      },
    ],
    [
      'transient NameID',
      { subjectFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' },
    ],
    ['wrong issuer', { issuer: 'urn:institution:other' }],
    ['wrong audience', { audiences: ['other-sp'] }],
    ['expired assertion', { expiresAt: now }],
  ])('rejects %s', (_name, changes) => {
    const f = saml();
    expect(() =>
      validateAssertion(f.config, f.tx, { ...f.assertion, ...changes }, now),
    ).toThrow(SSO_FAILED);
  });
});
describe('explicit identity and authorization boundary', () => {
  it('returns only authoritative local identity, role and credential version', () => {
    const f = fixture();
    expect(authorizeMappedIdentity(f.identity, f.mapping, f.auth)).toEqual({
      userId: 'user-a',
      opaRole: 'FACILITY_OPERATOR',
      credentialVersion: 3,
    });
  });
  it.each([
    ['disabled user', { userActive: false }],
    ['pending activation', { accountActivated: false }],
    ['removed membership', { membershipActive: false }],
    ['suspended operator', { operatorSuspended: true }],
    ['inactive organization', { organizationActive: false }],
    ['wrong membership tenant', { organizationId: 'org-b' }],
    ['wrong local user', { userId: 'user-b' }],
    ['ordinary ADMIN escalation attempt', { opaRole: 'ADMIN' }],
    [
      'explicit Super Admin must use local platform ceremony',
      { platformSuperAdmin: true },
    ],
  ])('rejects %s', (_name, changes) => {
    const f = fixture();
    expect(() =>
      authorizeMappedIdentity(f.identity, f.mapping, { ...f.auth, ...changes }),
    ).toThrow(SSO_FAILED);
  });
  it.each([
    ['subject collision', { subject: 'subject-b' }],
    ['issuer collision', { issuer: 'https://other.example.test' }],
    ['tenant collision', { organizationId: 'org-b' }],
    ['configuration collision', { configurationId: 'config-b' }],
    ['disabled mapping', { enabled: false }],
  ])('rejects %s', (_name, changes) => {
    const f = fixture();
    expect(() =>
      authorizeMappedIdentity(f.identity, { ...f.mapping, ...changes }, f.auth),
    ).toThrow(SSO_FAILED);
  });
  it('never uses colliding email or IdP roles to find or elevate a local user', () => {
    const f = fixture();
    const external = {
      ...f.assertion,
      email: 'existing-admin@example.test',
      roles: ['ADMIN', 'SUPER_ADMIN'],
    };
    const key = validateAssertion(f.config, f.tx, external, now);
    expect(key).toEqual(f.identity);
    expect(() => authorizeMappedIdentity(key, null, f.auth)).toThrow(
      SSO_FAILED,
    );
    expect(authorizeMappedIdentity(key, f.mapping, f.auth).opaRole).toBe(
      'FACILITY_OPERATOR',
    );
  });
  it('preserves exact subjects and cannot collide on separator concatenation', () => {
    const f = fixture();
    expect(
      identityKey({ ...f.identity, issuer: 'a|b', subject: 'c' }),
    ).not.toBe(identityKey({ ...f.identity, issuer: 'a', subject: 'b|c' }));
    expect(identityKey({ ...f.identity, subject: 'SUBJECT-a' })).not.toBe(
      identityKey(f.identity),
    );
  });
  it('same replay response yields same replay key across organization configurations', () => {
    const f = fixture();
    expect(replayKey(f.assertion)).toBe(replayKey({ ...f.assertion }));
    expect(replayKey(f.assertion)).not.toBe(
      replayKey({ ...f.assertion, issuer: 'other-issuer' }),
    );
  });
});
describe('secure linking proof boundary', () => {
  function link() {
    const f = fixture();
    f.tx.purpose = 'link';
    f.tx.targetUserId = f.auth.userId;
    const proof = {
      userId: f.auth.userId,
      transactionId: f.tx.id,
      identityKey: identityKey(f.identity),
      credentialVersion: 3,
      authenticatedAt: now - 1000,
      expiresAt: now + 60_000,
    };
    return { ...f, proof };
  }
  it('requires fresh local proof bound to exact verified identity', () => {
    const f = link();
    expect(() =>
      authorizeLink(f.identity, f.tx, f.proof, f.auth, null, now),
    ).not.toThrow();
  });
  it.each([
    ['wrong local user', { userId: 'user-b' }],
    ['wrong transaction', { transactionId: 'tx-b' }],
    ['wrong external identity', { identityKey: 'other' }],
    ['revoked credential', { credentialVersion: 2 }],
    ['expired proof', { expiresAt: now }],
    ['stale proof', { authenticatedAt: now - 600_000 }],
  ])('rejects %s', (_name, changes) => {
    const f = link();
    expect(() =>
      authorizeLink(
        f.identity,
        f.tx,
        { ...f.proof, ...changes },
        f.auth,
        null,
        now,
      ),
    ).toThrow(SSO_FAILED);
  });
  it('never reassigns an existing subject to a different account', () => {
    const f = link();
    expect(() =>
      authorizeLink(
        f.identity,
        f.tx,
        f.proof,
        f.auth,
        { ...f.mapping, userId: 'user-b' },
        now,
      ),
    ).toThrow(SSO_FAILED);
  });
});
describe('unwired callback coordinator contracts (mocked adapters)', () => {
  it('hands exact identity and replay guard to the existing-session completion port', async () => {
    const f = fixture();
    const verifier = { verify: jest.fn().mockResolvedValue(f.assertion) };
    const completion = {
      complete: jest.fn().mockResolvedValue({ accessToken: 'opa-session' }),
    };
    await expect(
      completeSsoLogin(
        f.config,
        f.tx,
        f.input,
        verifier,
        completion,
        () => now,
      ),
    ).resolves.toEqual({ accessToken: 'opa-session' });
    expect(completion.complete).toHaveBeenCalledWith({
      transactionId: f.tx.id,
      expectedConfigurationRevision: 1,
      identity: f.identity,
      replayKey: replayKey(f.assertion),
      replayExpiresAt: f.assertion.expiresAt + 60_000,
      correlationId: f.input.correlationId,
    });
  });
  it('does not exchange a response after state mismatch', async () => {
    const f = fixture();
    const verifier = { verify: jest.fn() },
      completion = { complete: jest.fn() };
    await expect(
      completeSsoLogin(
        f.config,
        f.tx,
        { ...f.input, state: 'wrong' },
        verifier,
        completion,
        () => now,
      ),
    ).rejects.toThrow(SSO_FAILED);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(completion.complete).not.toHaveBeenCalled();
  });
  it('does not issue sessions after signature verification failure and sanitizes provider errors', async () => {
    const f = fixture();
    const verifier = {
      verify: jest
        .fn()
        .mockRejectedValue(new Error('secret token=raw subject=email')),
    };
    const completion = { complete: jest.fn() };
    await expect(
      completeSsoLogin(
        f.config,
        f.tx,
        f.input,
        verifier,
        completion,
        () => now,
      ),
    ).rejects.toEqual(new Error(SSO_FAILED));
    expect(completion.complete).not.toHaveBeenCalled();
  });
  it('propagates replay denial from atomic persistence as a generic failure', async () => {
    const f = fixture();
    const verifier = { verify: jest.fn().mockResolvedValue(f.assertion) };
    const completion = {
      complete: jest
        .fn()
        .mockRejectedValue(new Error('unique replay violation')),
    };
    await expect(
      completeSsoLogin(
        f.config,
        f.tx,
        f.input,
        verifier,
        completion,
        () => now,
      ),
    ).rejects.toThrow(SSO_FAILED);
  });
  it('rechecks transaction expiry after a slow provider exchange', async () => {
    const f = fixture();
    const verifier = { verify: jest.fn().mockResolvedValue(f.assertion) },
      completion = { complete: jest.fn() };
    const clock = jest
      .fn()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 60_001);
    await expect(
      completeSsoLogin(f.config, f.tx, f.input, verifier, completion, clock),
    ).rejects.toThrow(SSO_FAILED);
    expect(completion.complete).not.toHaveBeenCalled();
  });
});
