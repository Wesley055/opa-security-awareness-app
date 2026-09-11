import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { JwtStrategy } from '../../src/modules/auth/jwt.strategy';
import { RefreshTokenService } from '../../src/modules/refresh-token/refresh-token.service';
import { SsoService } from '../../src/modules/sso/sso.service';
import type { ConfigurationInput } from '../../src/modules/sso/sso.service';
import { SsoSecrets } from '../../src/modules/sso/sso-secrets';
import { OidcProtocolVerifier } from '../../src/modules/sso/oidc-protocol-verifier';
import { SamlProtocolVerifier } from '../../src/modules/sso/saml-protocol-verifier';
import type {
  LoginTransaction,
  SsoConfiguration,
} from '../../src/modules/sso/sso.contracts';
import {
  settings,
  SignedOidcProvider,
  fixtureCert,
  signedSaml,
} from '../sso/fixtures';
import { prismaTest as db } from './prisma-test-client';
import { SSO_FAILED } from '../../src/modules/sso/sso.policy';

describe('SSO PostgreSQL authorization and atomic replay', () => {
  const password = 'Test-only-password!123';
  const jwt = new JwtService();
  let service: SsoService,
    provider: SignedOidcProvider,
    facilityId: string,
    otherFacility: string;
  let admin: { id: string; credentialVersion: number; token: string },
    member: typeof admin;
  let input: ConfigurationInput, configurationId: string;
  beforeEach(async () => {
    facilityId = (
      await db.facility.create({ data: { name: 'SSO Test', type: 'OTHER' } })
    ).id;
    otherFacility = (
      await db.facility.create({ data: { name: 'Other', type: 'OTHER' } })
    ).id;
    const user = async (
      role: 'ADMIN' | 'FACILITY_OPERATOR',
      facility: string | null,
    ) => {
      const u = await db.user.create({
        data: {
          email: randomUUID() + '@example.test',
          phoneNumber: randomUUID(),
          firstName: 'Masked',
          lastName: 'Person',
          role,
          facilityId: facility,
          passwordHash: await bcrypt.hash(password, 4),
        },
      });
      return {
        id: u.id,
        credentialVersion: 0,
        token: jwt.sign(
          { sub: u.id, credentialVersion: 0 },
          { secret: settings.getOrThrow<string>('JWT_ACCESS_SECRET') },
        ),
      };
    };
    admin = await user('ADMIN', null);
    member = await user('FACILITY_OPERATOR', facilityId);
    provider = new SignedOidcProvider();
    const secrets = new SsoSecrets(settings);
    const auth = new AuthService({} as never, jwt, settings);
    service = new SsoService(
      db as unknown as PrismaService,
      auth,
      settings,
      secrets,
      new OidcProtocolVerifier(secrets, provider.network()),
      new SamlProtocolVerifier(),
    );
    input = {
      providerType: 'OIDC',
      issuer: 'https://idp.example.test',
      audience: 'opa-client',
      enabled: true,
      clientSecret: 'test-client-secret',
      trust: {
        discoveryUrl:
          'https://idp.example.test/.well-known/openid-configuration',
        authorizationEndpoint: 'https://idp.example.test/authorize',
        tokenEndpoint: 'https://idp.example.test/token',
        jwksUri: 'https://idp.example.test/jwks',
      },
    };
    configurationId = (await service.save(admin, facilityId, input)).id;
  });
  async function begin(
    link = false,
    actor = member,
    change: Record<string, string | boolean> = {},
  ) {
    const initiation = await service.initiate(
      configurationId,
      link ? actor : undefined,
      link ? password : undefined,
    );
    const row = await db.ssoTransaction.findUniqueOrThrow({
      where: { id: initiation.transactionId },
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(300000);
    if (link) expect(row.expiresAt.getTime() - row.reauthenticatedAt!.getTime()).toBeLessThanOrEqual(300000);
    const configRow = await db.ssoConfiguration.findUniqueOrThrow({
      where: { id: configurationId },
    });
    const params = new URL(initiation.url).searchParams;
    const state = params.get('state') ?? params.get('RelayState')!;
    let rawResponse: string;
    if (configRow.providerType === 'OIDC')
      rawResponse = provider.accept(initiation.url);
    else {
      const config: SsoConfiguration = {
        id: configurationId,
        organizationId: facilityId,
        revision: configRow.revision,
        enabled: true,
        providerType: 'SAML2',
        issuer: input.issuer,
        audience: input.audience,
        callbackUrl: 'https://opa.example.test/api/sso/callback',
        trust: input.trust,
        trustMetadataReference: 'test',
        jit: { enabled: false },
      };
      const tx: LoginTransaction = {
        id: row.id,
        organizationId: row.facilityId,
        configurationId,
        configurationRevision: row.configurationRevision,
        purpose: link ? 'link' : 'login',
        stateHash: row.stateHash,
        browserBindingHash: row.browserBindingHash,
        requestId: row.requestId!,
        createdAt: row.createdAt.getTime(),
        expiresAt: row.expiresAt.getTime(),
      };
      rawResponse = Buffer.from(signedSaml(config, tx, change)).toString(
        'base64',
      );
    }
    return { ...initiation, state, rawResponse };
  }
  const finish = (
    b: Awaited<ReturnType<typeof begin>>,
    actor?: typeof member,
  ) =>
    service.callback(
      b.transactionId,
      b.state,
      b.browserBinding,
      b.rawResponse,
      actor,
    );
  async function linked() {
    await finish(await begin(true), member);
  }
  it('links after local reauthentication then issues normal OPA access and refresh tokens', async () => {
    await linked();
    const result = await finish(await begin());
    expect('accessToken' in result).toBe(true);
    if (!('accessToken' in result)) throw Error('Missing existing OPA session');
    const payload = jwt.verify(result.accessToken, {
      secret: settings.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
    expect(payload.sub).toBe(member.id);
    expect(payload.credentialVersion).toBe(0);
    expect(await db.user.count()).toBe(2);
    expect(
      await db.ssoAuditEvent.count({
        where: { action: 'AUTHENTICATION_SUCCEEDED' },
      }),
    ).toBe(1);
  });
  it('never exposes stored secrets in configuration responses', async () => {
    const listed = JSON.stringify(await service.list(admin, facilityId));
    expect(listed).not.toContain(input.clientSecret);
    expect(listed).not.toContain('ciphertext');
    expect(listed).not.toContain('keyVersion');
    const transaction = await begin();
    const row = JSON.stringify(
      await db.ssoTransaction.findUnique({
        where: { id: transaction.transactionId },
      }),
    );
    expect(row).not.toContain(transaction.browserBinding);
  });
  it('rejects email-only mapping and creates no users or memberships', async () => {
    provider.claims = {
      email: (await db.user.findUniqueOrThrow({ where: { id: member.id } }))
        .email,
    };
    await expect(finish(await begin())).rejects.toThrow(SSO_FAILED);
    expect(await db.user.count()).toBe(2);
    expect(await db.ssoExternalIdentity.count()).toBe(0);
  });
  it.each(['password', 'missing', 'admin'])(
    'denies linking with %s',
    async (mode) => {
      if (mode === 'password')
        await expect(
          service.initiate(configurationId, member, 'wrong'),
        ).rejects.toThrow();
      if (mode === 'missing')
        await expect(
          service.initiate(configurationId, member),
        ).rejects.toThrow();
      if (mode === 'admin')
        await expect(
          service.initiate(configurationId, admin, password),
        ).rejects.toThrow();
      expect(await db.ssoExternalIdentity.count()).toBe(0);
    },
  );
  it('binds staged linking to the original local session and single-use proof', async () => {
    const b = await begin(true);
    expect(await finish(b)).toEqual({ linkPending: true });
    await expect(
      service.finishLink(
        { ...member, token: 'other-session' },
        b.transactionId,
        b.browserBinding,
      ),
    ).rejects.toThrow();
    expect(
      await service.finishLink(member, b.transactionId, b.browserBinding),
    ).toEqual({ linked: true });
    await expect(
      service.finishLink(member, b.transactionId, b.browserBinding),
    ).rejects.toThrow();
  });
  it('rejects a stale local reauthentication proof', async () => {
    const b = await begin(true);
    await db.ssoTransaction.update({
      where: { id: b.transactionId },
      data: { reauthenticatedAt: new Date(Date.now() - 600000) },
    });
    await expect(finish(b, member)).rejects.toThrow();
  });
  it('prevents another user from stealing an existing identity', async () => {
    await linked();
    const other = await db.user.create({
      data: {
        email: randomUUID() + '@example.test',
        phoneNumber: randomUUID(),
        firstName: 'Other',
        lastName: 'Person',
        facilityId,
        role: 'FACILITY_OPERATOR',
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    const actor = {
      id: other.id,
      credentialVersion: 0,
      token: 'other-authenticated-session',
    };
    await expect(finish(await begin(true, actor), actor)).rejects.toThrow();
    expect((await db.ssoExternalIdentity.findFirstOrThrow()).userId).toBe(
      member.id,
    );
  });
  it.each(['suspended', 'membership-revoked', 'facility-suspended', 'admin'])(
    'denies %s after verification',
    async (mode) => {
      await linked();
      const b = await begin();
      if (mode === 'suspended')
        await db.user.update({
          where: { id: member.id },
          data: { isActive: false, credentialVersion: { increment: 1 } },
        });
      if (mode === 'membership-revoked')
        await db.user.update({
          where: { id: member.id },
          data: { facilityId: null, credentialVersion: { increment: 1 } },
        });
      if (mode === 'facility-suspended')
        await db.facility.update({
          where: { id: facilityId },
          data: { isActive: false },
        });
      if (mode === 'admin')
        await db.user.update({
          where: { id: member.id },
          data: { role: 'ADMIN' },
        });
      await expect(finish(b)).rejects.toThrow(SSO_FAILED);
    },
  );
  it('denies cross-tenant membership and configuration administration', async () => {
    await linked();
    const b = await begin();
    await db.user.update({
      where: { id: member.id },
      data: { facilityId: otherFacility },
    });
    await expect(finish(b)).rejects.toThrow();
    await expect(service.save(member, otherFacility, input)).rejects.toThrow();
  });
  it('rejects a different exact subject even with the same email claim', async () => {
    await linked();
    provider.claims = { sub: 'different', email: 'same@example.test' };
    await expect(finish(await begin())).rejects.toThrow();
  });
  it('unlinks with audit and invalidates existing OPA access and refresh tokens', async () => {
    await linked();
    const session = await finish(await begin());
    if (!('accessToken' in session)) throw Error('Missing session');
    const mapping = await db.ssoExternalIdentity.findFirstOrThrow();
    await service.unlink(member, mapping.id, password);
    const strategy = new JwtStrategy(settings, db as unknown as PrismaService);
    await expect(
      strategy.validate(
        jwt.verify(session.accessToken, {
          secret: settings.getOrThrow<string>('JWT_ACCESS_SECRET'),
        }),
      ),
    ).rejects.toThrow();
    const refresh = new RefreshTokenService(
      jwt,
      settings,
      db as unknown as PrismaService,
    );
    await expect(refresh.rotate(session.refreshToken)).rejects.toThrow();
    expect(
      await db.ssoAuditEvent.count({ where: { action: 'IDENTITY_UNLINKED' } }),
    ).toBe(1);
    expect(await db.ssoExternalIdentity.count()).toBe(1);
  });
  it('disabling configuration revokes sessions and pending callbacks', async () => {
    await linked();
    const b = await begin();
    await service.save(
      admin,
      facilityId,
      { ...input, enabled: false, expectedRevision: 1 },
      configurationId,
    );
    await expect(finish(b)).rejects.toThrow();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: member.id } }))
        .credentialVersion,
    ).toBe(1);
    expect(
      await db.ssoAuditEvent.count({ where: { action: 'SESSIONS_REVOKED' } }),
    ).toBe(1);
  });
  it('atomically rejects duplicate OIDC jti across different transactions', async () => {
    await linked();
    provider.claims = { jti: 'fixed-replay-id' };
    await finish(await begin());
    await expect(finish(await begin())).rejects.toThrow();
  });
  describe('SAML replay across PostgreSQL connections', () => {
    beforeEach(async () => {
      input = {
        ...input,
        providerType: 'SAML2',
        trust: {
          authorizationEndpoint: 'https://idp.example.test/authorize',
          certificates: [fixtureCert],
        },
      };
      configurationId = (await service.save(admin, facilityId, input)).id;
    });
    it('permits only one session for concurrent identical callbacks', async () => {
      await linked();
      const b = await begin();
      const result = await Promise.allSettled([finish(b), finish(b)]);
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await db.ssoAuditEvent.count({
          where: { action: 'AUTHENTICATION_SUCCEEDED' },
        }),
      ).toBe(1);
    });
    it.each(['assertionId', 'responseId'])(
      'rejects reused %s on a newly correlated signed response',
      async (key) => {
        await linked();
        const change = { [key]: '_fixed_identifier' };
        await finish(await begin(false, member, change));
        await expect(
          finish(await begin(false, member, change)),
        ).rejects.toThrow();
      },
    );
  });
});
