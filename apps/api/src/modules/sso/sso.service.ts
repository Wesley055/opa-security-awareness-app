import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
  SsoConfiguration as ConfigRow,
  SsoTransaction as TransactionRow,
} from '@prisma/client';
import { randomUUID, X509Certificate } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import type {
  ExternalIdentityKey,
  LoginTransaction,
  MembershipAuthorization,
  SecretReference,
  SsoConfiguration,
  VerifiedAssertion,
} from './sso.contracts';
import {
  authorizeLink,
  authorizeMappedIdentity,
  createCorrelationMaterial,
  digest,
  identityKey,
  replayKey,
  SsoDenied,
  validateAssertion,
} from './sso.policy';
import { OidcProtocolVerifier } from './oidc-protocol-verifier';
import { SamlProtocolVerifier } from './saml-protocol-verifier';
import { approvedHttps } from './sso-network';
import { SsoSecrets } from './sso-secrets';
import { verifySsoCallback } from './sso.callback';

type Actor = { id: string; credentialVersion: number; token: string };
export interface ConfigurationInput {
  providerType: 'OIDC' | 'SAML2';
  issuer: string;
  audience: string;
  enabled: boolean;
  trust: SsoConfiguration['trust'];
  clientSecret?: string;
  expectedRevision?: number;
}
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const ref = (value: Prisma.JsonValue | null): SecretReference | undefined =>
  value == null ? undefined : (value as unknown as SecretReference);
@Injectable()
export class SsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly env: ConfigService,
    private readonly secrets: SsoSecrets,
    private readonly oidc: OidcProtocolVerifier,
    private readonly saml: SamlProtocolVerifier,
  ) {}
  private configuration(row: ConfigRow): SsoConfiguration {
    const origin = this.env.getOrThrow<string>('SSO_WEB_ORIGIN');
    const parsed = approvedHttps(origin);
    if (parsed.origin !== origin) throw new SsoDenied();
    return {
      id: row.id,
      organizationId: row.facilityId,
      revision: row.revision,
      enabled: row.enabled,
      providerType: row.providerType as 'OIDC' | 'SAML2',
      issuer: row.issuer,
      audience: row.audience,
      callbackUrl: origin + '/api/sso/callback',
      trust: row.trust as unknown as SsoConfiguration['trust'],
      trustMetadataReference: row.id + ':' + row.revision,
      secret: ref(row.secret),
      jit: { enabled: false },
    };
  }
  private transaction(row: TransactionRow): LoginTransaction {
    return {
      id: row.id,
      organizationId: row.facilityId,
      configurationId: row.configurationId,
      configurationRevision: row.configurationRevision,
      purpose: row.purpose as 'login' | 'link',
      targetUserId: row.targetUserId ?? undefined,
      stateHash: row.stateHash,
      browserBindingHash: row.browserBindingHash,
      nonceHash: row.nonceHash ?? undefined,
      nonce: ref(row.nonce),
      pkceVerifier: ref(row.pkceVerifier),
      requestId: row.requestId ?? undefined,
      createdAt: row.createdAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
    };
  }
  private async lockUser(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
    return tx.user.findUnique({ where: { id } });
  }
  private async actor(
    tx: Prisma.TransactionClient,
    actor: Actor,
    facilityId: string,
    admin = false,
  ) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id}::uuid FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id: actor.id } });
    if (
      !user?.isActive ||
      user.accountStatus !== 'ACTIVE' ||
      user.credentialVersion !== actor.credentialVersion ||
      (admin &&
        user.role !== 'ADMIN' &&
        !(user.role === 'FACILITY_ADMIN' && user.facilityId === facilityId))
    )
      throw new SsoDenied();
    return user;
  }
  private async membership(
    tx: Prisma.TransactionClient,
    userId: string,
    facilityId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR SHARE`;
    const user = await this.lockUser(tx, userId);
    const facility = await tx.facility.findUnique({
      where: { id: facilityId },
    });
    const auth: MembershipAuthorization = {
      userId,
      organizationId: facilityId,
      userActive: user?.isActive === true,
      accountActivated: user?.accountStatus === 'ACTIVE',
      organizationActive: facility?.isActive === true,
      membershipActive: user?.facilityId === facilityId && user.isActive,
      operatorSuspended: user?.isActive !== true,
      credentialVersion: user?.credentialVersion ?? -1,
      opaRole: user?.role ?? '',
      platformSuperAdmin: user?.role === 'ADMIN',
    };
    if (!user) throw new SsoDenied();
    return { user, auth };
  }
  private validateTrust(input: ConfigurationInput) {
    if (
      !['OIDC', 'SAML2'].includes(input.providerType) ||
      !input.issuer ||
      input.issuer.length > 2048 ||
      !input.audience ||
      input.audience.length > 2048
    )
      throw new SsoDenied();
    approvedHttps(input.trust.authorizationEndpoint);
    if (input.providerType === 'OIDC') {
      const issuer = approvedHttps(input.issuer);
      if (issuer.search) throw new SsoDenied();
      const expected =
        issuer.href.replace(/\/$/, '') + '/.well-known/openid-configuration';
      if (
        input.trust.discoveryUrl !== expected ||
        !input.trust.tokenEndpoint ||
        !input.trust.jwksUri
      )
        throw new SsoDenied();
      approvedHttps(input.trust.tokenEndpoint);
      approvedHttps(input.trust.jwksUri);
    } else {
      if (
        !input.trust.certificates?.length ||
        input.trust.certificates.length > 3
      )
        throw new SsoDenied();
      for (const value of input.trust.certificates) {
        const cert = new X509Certificate(value);
        if (
          cert.publicKey.asymmetricKeyType !== 'rsa' ||
          (cert.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
          Date.parse(cert.validTo) <= Date.now() ||
          Date.parse(cert.validFrom) > Date.now()
        )
          throw new SsoDenied();
      }
    }
  }
  private publicConfig(row: ConfigRow) {
    return {
      id: row.id,
      facilityId: row.facilityId,
      providerType: row.providerType,
      issuer: row.issuer,
      audience: row.audience,
      revision: row.revision,
      enabled: row.enabled,
      hasSecret: row.secret !== null,
      jitEnabled: false,
    };
  }
  async save(
    actor: Actor,
    facilityId: string,
    input: ConfigurationInput,
    id?: string,
  ) {
    try {
      return await this.saveConfiguration(actor, facilityId, input, id);
    } catch {
      await this.prisma.ssoAuditEvent.create({
        data: {
          actorUserId: actor.id,
          facilityId,
          configurationId: id,
          action: 'CONFIGURATION_CHANGE_DENIED',
          outcome: 'denied',
        },
      });
      throw new SsoDenied();
    }
  }
  private async saveConfiguration(
    actor: Actor,
    facilityId: string,
    input: ConfigurationInput,
    id?: string,
  ) {
    this.validateTrust(input);
    const configurationId = id ?? randomUUID();
    const result = await this.prisma.$transaction(async (tx) => {
      if (id)
        await tx.$queryRaw`SELECT id FROM "SsoConfiguration" WHERE id=${id}::uuid FOR UPDATE`;
      await this.actor(tx, actor, facilityId, true);
      const facility = await tx.facility.findUnique({
        where: { id: facilityId },
      });
      if (!facility || (input.enabled && !facility.isActive))
        throw new SsoDenied();
      const current = id
        ? await tx.ssoConfiguration.findUnique({ where: { id } })
        : null;
      if (
        id &&
        (!current ||
          current.facilityId !== facilityId ||
          input.expectedRevision !== current.revision ||
          current.providerType !== input.providerType ||
          current.issuer !== input.issuer ||
          current.audience !== input.audience)
      )
        throw new SsoDenied();
      // Identity namespace is immutable. A different issuer/client requires a new configuration.
      const secret = input.clientSecret
        ? json(
            this.secrets.seal(input.clientSecret, 'config:' + configurationId),
          )
        : current?.secret;
      if (input.providerType === 'OIDC' && !secret) throw new SsoDenied();
      if (current) {
        const users = await tx.ssoExternalIdentity.findMany({
          where: { configurationId, enabled: true },
          select: { userId: true },
          distinct: ['userId'],
          orderBy: { userId: 'asc' },
        });
        for (const { userId } of users) {
          const user = await this.lockUser(tx, userId);
          // A historic tenant link cannot grant authority over a platform administrator.
          if (user && user.role !== 'ADMIN')
            await tx.user.update({
              where: { id: userId },
              data: { credentialVersion: { increment: 1 } },
            });
        }
      }
      const data = {
        facilityId,
        providerType: input.providerType,
        issuer: input.issuer,
        audience: input.audience,
        enabled: input.enabled,
        trust: json(input.trust),
        ...(secret ? { secret: json(secret) } : {}),
      };
      const row = current
        ? await tx.ssoConfiguration.update({
            where: { id: configurationId },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.ssoConfiguration.create({
            data: { ...data, id: configurationId },
          });
      await tx.ssoAuditEvent.create({
        data: {
          facilityId,
          configurationId,
          actorUserId: actor.id,
          action: current
            ? input.enabled
              ? 'CONFIGURATION_UPDATED'
              : 'CONFIGURATION_DISABLED'
            : 'CONFIGURATION_CREATED',
          outcome: 'success',
          configurationRevision: row.revision,
        },
      });
      if (current)
        await tx.ssoAuditEvent.create({
          data: {
            facilityId,
            configurationId,
            actorUserId: actor.id,
            action: 'SESSIONS_REVOKED',
            outcome: 'success',
            configurationRevision: row.revision,
          },
        });
      return this.publicConfig(row);
    });
    this.oidc.invalidate(configurationId);
    return result;
  }
  async list(actor: Actor, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.actor(tx, actor, facilityId, true);
      return (
        await tx.ssoConfiguration.findMany({
          where: { facilityId },
          orderBy: { id: 'asc' },
          take: 100,
        })
      ).map((row) => this.publicConfig(row));
    });
  }
  async audit(actor: Actor, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.actor(tx, actor, facilityId, true);
      return tx.ssoAuditEvent.findMany({
        where: { facilityId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  }
  async initiate(configurationId: string, actor?: Actor, password?: string) {
    const material = createCorrelationMaterial();
    const id = randomUUID();
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SsoConfiguration" WHERE id=${configurationId}::uuid FOR SHARE`;
      const row = await tx.ssoConfiguration.findUnique({
        where: { id: configurationId },
      });
      if (!row?.enabled) throw new SsoDenied();
      const config = this.configuration(row);
      const facility = await tx.facility.findUnique({
        where: { id: row.facilityId },
      });
      if (!facility?.isActive) throw new SsoDenied();
      let credentialVersion: number | undefined;
      if (actor) {
        const { user, auth } = await this.membership(
          tx,
          actor.id,
          row.facilityId,
        );
        await this.actor(tx, actor, row.facilityId);
        if (
          !password ||
          !user.passwordHash ||
          !(await bcrypt.compare(password, user.passwordHash))
        )
          throw new SsoDenied();
        // Run the same eligibility policy before generating the external proof.
        const pending: ExternalIdentityKey = {
          organizationId: row.facilityId,
          configurationId,
          providerType: config.providerType,
          issuer: config.issuer,
          subject: 'pending',
          subjectFormat: 'pending',
        };
        authorizeMappedIdentity(
          pending,
          { ...pending, id: 'pending', userId: user.id, enabled: true },
          auth,
        );
        credentialVersion = user.credentialVersion;
      }
      // One clock sample keeps the reauthentication and transaction lifetime
      // exactly five minutes even when encryption or persistence takes time.
      const createdAt = new Date();
      const transaction = await tx.ssoTransaction.create({
        data: {
          id,
          createdAt,
          configurationId,
          facilityId: row.facilityId,
          configurationRevision: row.revision,
          purpose: actor ? 'link' : 'login',
          stateHash: digest(material.state),
          browserBindingHash: digest(material.browserBinding),
          ...(config.providerType === 'OIDC'
            ? {
                nonceHash: digest(material.nonce),
                nonce: json(this.secrets.seal(material.nonce, 'nonce:' + id)),
                pkceVerifier: json(
                  this.secrets.seal(material.pkceVerifier, 'pkce:' + id),
                ),
              }
            : { requestId: '_' + randomUUID() }),
          ...(actor
            ? {
                targetUserId: actor.id,
                credentialVersion,
                reauthenticatedAt: createdAt,
                linkSessionHash: digest(actor.token),
              }
            : {}),
          expiresAt: new Date(createdAt.getTime() + 300000),
        },
      });
      return { config, transaction: this.transaction(transaction) };
    });
    const verifier =
      saved.config.providerType === 'OIDC' ? this.oidc : this.saml;
    const url = await verifier.initiate(
      saved.config,
      saved.transaction,
      material.state,
    );
    return { transactionId: id, browserBinding: material.browserBinding, url };
  }
  async callback(
    id: string,
    state: string,
    browserBinding: string,
    rawResponse: string,
    actor?: Actor,
  ) {
    let config: SsoConfiguration | undefined;
    try {
      const row = await this.prisma.ssoTransaction.findUnique({
        where: { id },
      });
      if (!row || row.consumedAt) throw new SsoDenied();
      const configuration = await this.prisma.ssoConfiguration.findUnique({
        where: { id: row.configurationId },
      });
      if (!configuration) throw new SsoDenied();
      config = this.configuration(configuration);
      const transaction = this.transaction(row);
      const input = {
        organizationId: config.organizationId,
        state,
        browserBinding,
      };
      const { assertion, identity } = await verifySsoCallback(
        config,
        transaction,
        { ...input, rawResponse },
        config.providerType === 'OIDC' ? this.oidc : this.saml,
      );
      if (transaction.purpose === 'link' && !actor) {
        const proof = this.secrets.seal(
          JSON.stringify({ assertion, identity }),
          'proof:' + transaction.id,
        );
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "SsoConfiguration" WHERE id=${config!.id}::uuid FOR SHARE`;
          const current = await tx.ssoConfiguration.findUnique({
            where: { id: config!.id },
          });
          if (!current?.enabled || current.revision !== config!.revision)
            throw new SsoDenied();
          const changed = await tx.ssoTransaction.updateMany({
            where: {
              id,
              consumedAt: null,
              verifiedAt: null,
              expiresAt: { gt: new Date() },
            },
            data: { verifiedProof: json(proof), verifiedAt: new Date() },
          });
          if (changed.count !== 1) throw new SsoDenied();
        });
        return { linkPending: true };
      }
      return await this.complete(
        config,
        transaction,
        assertion,
        identity,
        actor,
      );
    } catch {
      await this.prisma.ssoAuditEvent.create({
        data: {
          transactionId: id,
          facilityId: config?.organizationId,
          configurationId: config?.id,
          action: 'AUTHENTICATION_FAILED',
          outcome: 'denied',
        },
      });
      throw new SsoDenied();
    }
  }
  private async complete(
    config: SsoConfiguration,
    transaction: LoginTransaction,
    assertion: VerifiedAssertion,
    identity: ExternalIdentityKey,
    actor?: Actor,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SsoConfiguration" WHERE id=${config.id}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "SsoTransaction" WHERE id=${transaction.id}::uuid FOR UPDATE`;
      const current = await tx.ssoConfiguration.findUnique({
        where: { id: config.id },
      });
      const pending = await tx.ssoTransaction.findUnique({
        where: { id: transaction.id },
      });
      if (
        !current?.enabled ||
        current.revision !== config.revision ||
        !pending ||
        pending.consumedAt ||
        pending.expiresAt <= new Date()
      )
        throw new SsoDenied();
      validateAssertion(config, transaction, assertion, Date.now());
      const key = this.secrets.identityDigest(identityKey(identity));
      const mapping = await tx.ssoExternalIdentity.findUnique({
        where: {
          configurationId_identityDigest: {
            configurationId: config.id,
            identityDigest: key,
          },
        },
      });
      const userId =
        transaction.purpose === 'link' ? pending.targetUserId : mapping?.userId;
      if (!userId) throw new SsoDenied(); // No JIT and no email fallback.
      const { user, auth } = await this.membership(
        tx,
        userId,
        config.organizationId,
      );
      const stored = mapping
        ? (JSON.parse(
            this.secrets.open(
              mapping.identityCiphertext as unknown as SecretReference,
              'identity:' + mapping.id,
            ),
          ) as ExternalIdentityKey)
        : null;
      if (stored && identityKey(stored) !== identityKey(identity))
        throw new SsoDenied();
      if (transaction.purpose === 'link') {
        if (
          !actor ||
          actor.id !== userId ||
          digest(actor.token) !== pending.linkSessionHash ||
          actor.credentialVersion !== user.credentialVersion
        )
          throw new SsoDenied();
        authorizeLink(
          identity,
          transaction,
          {
            userId,
            transactionId: transaction.id,
            identityKey: identityKey(identity),
            credentialVersion: pending.credentialVersion ?? -1,
            authenticatedAt: pending.reauthenticatedAt?.getTime() ?? 0,
            expiresAt: pending.expiresAt.getTime(),
          },
          auth,
          mapping
            ? {
                ...identity,
                id: mapping.id,
                userId: mapping.userId,
                enabled: mapping.enabled,
              }
            : null,
          Date.now(),
        );
      } else {
        authorizeMappedIdentity(
          identity,
          mapping
            ? {
                ...identity,
                id: mapping.id,
                userId: mapping.userId,
                enabled: mapping.enabled,
              }
            : null,
          auth,
        );
      }
      // Distinct namespaces; uniqueness spans all configurations for an issuer.
      const expiresAt = new Date(assertion.expiresAt + 60000);
      await tx.ssoReplay.create({
        data: { key: replayKey(assertion), expiresAt },
      });
      if (assertion.providerType === 'SAML2') {
        if (!assertion.samlResponseId) throw new SsoDenied();
        await tx.ssoReplay.create({
          data: {
            key: digest(
              JSON.stringify([
                'SAML2_RESPONSE',
                assertion.issuer,
                assertion.samlResponseId,
              ]),
            ),
            expiresAt,
          },
        });
      }
      await tx.ssoTransaction.update({
        where: { id: pending.id },
        data: {
          consumedAt: new Date(),
          nonce: Prisma.DbNull,
          pkceVerifier: Prisma.DbNull,
          verifiedProof: Prisma.DbNull,
        },
      });
      let mappingId = mapping?.id;
      if (transaction.purpose === 'link') {
        mappingId = randomUUID();
        await tx.ssoExternalIdentity.create({
          data: {
            id: mappingId,
            facilityId: config.organizationId,
            configurationId: config.id,
            userId,
            identityDigest: key,
            identityCiphertext: json(
              this.secrets.seal(
                JSON.stringify(identity),
                'identity:' + mappingId,
              ),
            ),
          },
        });
      }
      await tx.ssoAuditEvent.create({
        data: {
          facilityId: config.organizationId,
          configurationId: config.id,
          configurationRevision: config.revision,
          transactionId: pending.id,
          targetUserId: userId,
          actorUserId: actor?.id,
          mappingId,
          action:
            transaction.purpose === 'link'
              ? 'IDENTITY_LINKED'
              : 'AUTHENTICATION_SUCCEEDED',
          outcome: 'success',
        },
      });
      return transaction.purpose === 'link'
        ? { linked: true }
        : this.auth.issueTokens(user);
    });
  }
  async finishLink(actor: Actor, id: string, browserBinding: string) {
    try {
      const pending = await this.prisma.ssoTransaction.findUnique({
        where: { id },
      });
      if (
        !pending?.verifiedProof ||
        !pending.verifiedAt ||
        pending.purpose !== 'link' ||
        pending.consumedAt ||
        pending.browserBindingHash !== digest(browserBinding) ||
        pending.targetUserId !== actor.id
      )
        throw new SsoDenied();
      const row = await this.prisma.ssoConfiguration.findUnique({
        where: { id: pending.configurationId },
      });
      if (!row) throw new SsoDenied();
      const proof = JSON.parse(
        this.secrets.open(
          pending.verifiedProof as unknown as SecretReference,
          'proof:' + id,
        ),
      ) as { assertion: VerifiedAssertion; identity: ExternalIdentityKey };
      return await this.complete(
        this.configuration(row),
        this.transaction(pending),
        proof.assertion,
        proof.identity,
        actor,
      );
    } catch {
      await this.prisma.ssoAuditEvent.create({
        data: {
          transactionId: id,
          actorUserId: actor.id,
          action: 'IDENTITY_LINK_FAILED',
          outcome: 'denied',
        },
      });
      throw new SsoDenied();
    }
  }
  async unlink(actor: Actor, mappingId: string, password: string) {
    try {
      return await this.unlinkIdentity(actor, mappingId, password);
    } catch {
      await this.prisma.ssoAuditEvent.create({
        data: {
          actorUserId: actor.id,
          mappingId,
          action: 'IDENTITY_UNLINK_DENIED',
          outcome: 'denied',
        },
      });
      throw new SsoDenied();
    }
  }
  private async unlinkIdentity(
    actor: Actor,
    mappingId: string,
    password: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const mapping = await tx.ssoExternalIdentity.findUnique({
        where: { id: mappingId },
      });
      if (!mapping || mapping.userId !== actor.id || !mapping.enabled)
        throw new SsoDenied();
      await tx.$queryRaw`SELECT id FROM "SsoConfiguration" WHERE id=${mapping.configurationId}::uuid FOR SHARE`;
      const user = await this.lockUser(tx, actor.id);
      await this.actor(tx, actor, mapping.facilityId);
      if (
        !user?.passwordHash ||
        !(await bcrypt.compare(password, user.passwordHash))
      )
        throw new SsoDenied();
      const changed = await tx.ssoExternalIdentity.updateMany({
        where: { id: mappingId, userId: actor.id, enabled: true },
        data: { enabled: false, unlinkedAt: new Date() },
      });
      if (changed.count !== 1) throw new SsoDenied();
      await tx.user.update({
        where: { id: actor.id },
        data: { credentialVersion: { increment: 1 } },
      });
      for (const action of ['IDENTITY_UNLINKED', 'SESSIONS_REVOKED'])
        await tx.ssoAuditEvent.create({
          data: {
            facilityId: mapping.facilityId,
            configurationId: mapping.configurationId,
            actorUserId: actor.id,
            targetUserId: actor.id,
            mappingId,
            action,
            outcome: 'success',
          },
        });
      return { unlinked: true, reauthenticationRequired: true };
    });
  }
  async identities(actor: Actor) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user?.isActive || user.credentialVersion !== actor.credentialVersion)
      throw new SsoDenied();
    return this.prisma.ssoExternalIdentity.findMany({
      where: { userId: actor.id },
      select: {
        id: true,
        configurationId: true,
        facilityId: true,
        enabled: true,
        linkedAt: true,
        unlinkedAt: true,
      },
    });
  }
}
