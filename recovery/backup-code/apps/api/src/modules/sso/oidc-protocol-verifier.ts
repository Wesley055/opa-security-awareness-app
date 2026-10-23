import { Injectable } from '@nestjs/common';
import * as oidcClient from 'openid-client';
import type { Configuration, CustomFetch } from 'openid-client';
import type {
  LoginTransaction,
  ProtocolVerifier,
  SsoConfiguration,
  VerifiedAssertion,
} from './sso.contracts';
import { digest, SsoDenied, validateAssertion } from './sso.policy';
import { SsoSecrets } from './sso-secrets';
import { approvedHttps, SsoNetwork } from './sso-network';

// CommonJS output uses Node's require(ESM), requiring Node >=22.12.
const loadClient: () => Promise<typeof oidcClient> = async () => oidcClient;
@Injectable()
export class OidcProtocolVerifier implements ProtocolVerifier {
  private readonly cache = new Map<
    string,
    { revision: number; expires: number; client: Promise<Configuration> }
  >();
  constructor(
    private readonly secrets: SsoSecrets,
    private readonly network: SsoNetwork,
  ) {}
  invalidate(id: string): void {
    this.cache.delete(id);
  }
  private async client(config: SsoConfiguration): Promise<Configuration> {
    const cached = this.cache.get(config.id);
    if (
      cached &&
      cached.revision === config.revision &&
      cached.expires > Date.now()
    )
      return cached.client;
    const promise = this.configure(config);
    if (this.cache.size >= 256)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(config.id, {
      revision: config.revision,
      expires: Date.now() + 300000,
      client: promise,
    });
    try {
      return await promise;
    } catch {
      this.invalidate(config.id);
      throw new SsoDenied();
    }
  }
  private async configure(config: SsoConfiguration): Promise<Configuration> {
    const oidc = await loadClient();
    const trust = config.trust;
    if (
      !trust.discoveryUrl ||
      !trust.tokenEndpoint ||
      !trust.jwksUri ||
      !config.secret
    )
      throw new SsoDenied();
    const endpoints = [trust.discoveryUrl, trust.tokenEndpoint, trust.jwksUri];
    endpoints.forEach(approvedHttps);
    approvedHttps(config.issuer);
    approvedHttps(trust.authorizationEndpoint);
    const fetcher: CustomFetch = this.network.forEndpoints(endpoints);
    const secret = this.secrets.open(config.secret, 'config:' + config.id);
    const client = await oidc.discovery(
      new URL(config.issuer),
      config.audience,
      { id_token_signed_response_alg: 'RS256' },
      oidc.ClientSecretBasic(secret),
      {
        [oidc.customFetch]: fetcher,
        execute: [oidc.enableNonRepudiationChecks],
        timeout: 5,
      },
    );
    const metadata = client.serverMetadata();
    if (
      metadata.issuer !== config.issuer ||
      metadata.authorization_endpoint !== trust.authorizationEndpoint ||
      metadata.token_endpoint !== trust.tokenEndpoint ||
      metadata.jwks_uri !== trust.jwksUri ||
      !metadata.code_challenge_methods_supported?.includes('S256')
    )
      throw new SsoDenied();
    return client;
  }
  async initiate(
    config: SsoConfiguration,
    tx: LoginTransaction,
    state: string,
  ): Promise<string> {
    if (!tx.nonce || !tx.pkceVerifier) throw new SsoDenied();
    const oidc = await loadClient();
    const verifier = this.secrets.open(tx.pkceVerifier, 'pkce:' + tx.id);
    return oidc.buildAuthorizationUrl(await this.client(config), {
      response_type: 'code',
      scope: 'openid',
      redirect_uri: config.callbackUrl,
      state,
      nonce: this.secrets.open(tx.nonce, 'nonce:' + tx.id),
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    }).href;
  }
  async verify(
    config: SsoConfiguration,
    tx: LoginTransaction,
    raw: unknown,
  ): Promise<VerifiedAssertion> {
    try {
      if (
        config.providerType !== 'OIDC' ||
        typeof raw !== 'string' ||
        raw.length > 16384 ||
        !tx.nonce ||
        !tx.pkceVerifier
      )
        throw new SsoDenied();
      const callback = new URL(raw);
      const state = callback.searchParams.get('state');
      if (
        !state ||
        digest(state) !== tx.stateHash ||
        callback.origin + callback.pathname !== config.callbackUrl
      )
        throw new SsoDenied();
      for (const key of ['code', 'state', 'iss', 'error'])
        if (callback.searchParams.getAll(key).length > 1) throw new SsoDenied();
      const oidc = await loadClient();
      const tokens = await oidc.authorizationCodeGrant(
        await this.client(config),
        callback,
        {
          expectedState: state,
          expectedNonce: this.secrets.open(tx.nonce, 'nonce:' + tx.id),
          pkceCodeVerifier: this.secrets.open(tx.pkceVerifier, 'pkce:' + tx.id),
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      if (!claims || !tokens.id_token || typeof claims.sub !== 'string')
        throw new SsoDenied();
      const assertion: VerifiedAssertion = {
        providerType: 'OIDC',
        issuer: claims.iss,
        subject: claims.sub,
        subjectFormat: 'sub',
        audiences: typeof claims.aud === 'string' ? [claims.aud] : claims.aud,
        authorizedParty:
          typeof claims.azp === 'string' ? claims.azp : undefined,
        issuedAt: claims.iat * 1000,
        expiresAt: claims.exp * 1000,
        notBefore:
          claims.nbf === undefined
            ? claims.iat * 1000
            : Number(claims.nbf) * 1000,
        nonce: typeof claims.nonce === 'string' ? claims.nonce : undefined,
        responseId:
          typeof claims.jti === 'string'
            ? 'jti:' + claims.jti
            : 'token:' + digest(tokens.id_token),
      };
      if (claims.azp !== undefined && typeof claims.azp !== 'string')
        throw new SsoDenied();
      validateAssertion(config, tx, assertion, Date.now());
      return assertion;
    } catch {
      throw new SsoDenied();
    }
  }
}
