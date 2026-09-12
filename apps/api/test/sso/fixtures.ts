import { createHash, generateKeyPairSync, randomUUID, sign } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { SignedXml } from 'xml-crypto';
import type { CustomFetch } from 'openid-client';
import type {
  LoginTransaction,
  SsoConfiguration,
} from '../../src/modules/sso/sso.contracts';
import {
  createCorrelationMaterial,
  digest,
  PERSISTENT_NAME_ID,
} from '../../src/modules/sso/sso.policy';
import { SsoSecrets } from '../../src/modules/sso/sso-secrets';
import type { SsoNetwork } from '../../src/modules/sso/sso-network';
const fixtureSettings = {
  SSO_ENCRYPTION_KEYS: JSON.stringify({
    active: 'test1',
    keys: { test1: 'ab'.repeat(32) },
  }),
  SSO_LOOKUP_KEY: 'cd'.repeat(32),
  SSO_WEB_ORIGIN: 'https://opa.example.test',
  JWT_ACCESS_SECRET: 'access-test-only-'.repeat(4),
  JWT_REFRESH_SECRET: 'refresh-test-only-'.repeat(4),
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
  BCRYPT_ROUNDS: 4,
};
export const settings = new ConfigService(fixtureSettings);
// Keep typed public test settings independent of developer process.env values.
jest.spyOn(settings, "get").mockImplementation(
  (key) => fixtureSettings[key as keyof typeof fixtureSettings] as never,
);
export const fixtureKey = readFileSync(
  join(__dirname, 'fixture-key.pem'),
  'utf8',
);
export const fixtureCert = readFileSync(
  join(__dirname, 'fixture-cert.pem'),
  'utf8',
);
export function protocolFixture(providerType: 'OIDC' | 'SAML2' = 'OIDC') {
  const secrets = new SsoSecrets(settings);
  const material = createCorrelationMaterial();
  const id = randomUUID(),
    txId = randomUUID();
  const issuer = 'https://idp.example.test';
  const config: SsoConfiguration = {
    id,
    organizationId: randomUUID(),
    revision: 1,
    enabled: true,
    providerType,
    issuer,
    audience: 'opa-client',
    callbackUrl: 'https://opa.example.test/api/sso/callback',
    jit: { enabled: false },
    trustMetadataReference: 'test-registry',
    trust: {
      discoveryUrl: issuer + '/.well-known/openid-configuration',
      authorizationEndpoint: issuer + '/authorize',
      tokenEndpoint: issuer + '/token',
      jwksUri: issuer + '/jwks',
      certificates: [fixtureCert],
    },
    secret: secrets.seal('test-client-secret', 'config:' + id),
  };
  const tx: LoginTransaction = {
    id: txId,
    organizationId: config.organizationId,
    configurationId: id,
    configurationRevision: 1,
    purpose: 'login',
    stateHash: digest(material.state),
    browserBindingHash: digest(material.browserBinding),
    nonceHash: digest(material.nonce),
    nonce: secrets.seal(material.nonce, 'nonce:' + txId),
    pkceVerifier: secrets.seal(material.pkceVerifier, 'pkce:' + txId),
    requestId: '_' + randomUUID(),
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 240000,
  };
  return { config, tx, secrets, material };
}
export class SignedOidcProvider {
  readonly keys = [
    generateKeyPairSync('rsa', { modulusLength: 2048 }),
    generateKeyPairSync('rsa', { modulusLength: 2048 }),
  ];
  readonly codes = new Map<string, { nonce: string; challenge: string }>();
  published = [0];
  signing = 0;
  kidOverride?: string;
  badSignature = false;
  claims: Record<string, unknown> = {};
  jwksReads = 0;
  discoveryReads = 0;
  accept(url: string) {
    const request = new URL(url);
    const code = randomUUID();
    this.codes.set(code, {
      nonce: request.searchParams.get('nonce')!,
      challenge: request.searchParams.get('code_challenge')!,
    });
    return (
      request.searchParams.get('redirect_uri') +
      '?code=' +
      code +
      '&state=' +
      request.searchParams.get('state') +
      '&iss=' +
      encodeURIComponent('https://idp.example.test')
    );
  }
  network(): SsoNetwork {
    return { forEndpoints: () => this.fetch } as SsoNetwork;
  }
  fetch: CustomFetch = async (input, options) => {
    const url = String(input);
    const response = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/.well-known/openid-configuration')) {
      this.discoveryReads++;
      return response({
        issuer: 'https://idp.example.test',
        authorization_endpoint: 'https://idp.example.test/authorize',
        token_endpoint: 'https://idp.example.test/token',
        jwks_uri: 'https://idp.example.test/jwks',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.endsWith('/jwks')) {
      this.jwksReads++;
      return response({
        keys: this.published.map((i) => ({
          ...this.keys[i]!.publicKey.export({ format: 'jwk' }),
          kid: 'key' + i,
          alg: 'RS256',
          use: 'sig',
        })),
      });
    }
    if (url.endsWith('/token')) {
      const params = new URLSearchParams(String(options?.body));
      const code = params.get('code')!;
      const pending = this.codes.get(code);
      this.codes.delete(code);
      if (
        !pending ||
        createHash('sha256')
          .update(params.get('code_verifier') ?? '')
          .digest('base64url') !== pending.challenge
      )
        return response({ error: 'invalid_grant' }, 400);
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: 'https://idp.example.test',
        aud: 'opa-client',
        sub: 'exact-subject',
        nonce: pending.nonce,
        iat: now - 1,
        exp: now + 120,
        nbf: now - 1,
        jti: randomUUID(),
        ...this.claims,
      };
      const header = {
        alg: 'RS256',
        kid: this.kidOverride ?? 'key' + this.signing,
      };
      const data =
        Buffer.from(JSON.stringify(header)).toString('base64url') +
        '.' +
        Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = sign(
        'RSA-SHA256',
        Buffer.from(data),
        this.keys[this.badSignature ? 1 - this.signing : this.signing]!
          .privateKey,
      ).toString('base64url');
      return response({
        access_token: 'provider-access-not-for-browser',
        token_type: 'Bearer',
        id_token: data + '.' + signature,
      });
    }
    throw Error('Unexpected provider endpoint');
  };
}
const A = 'urn:oasis:names:tc:SAML:2.0:assertion',
  P = 'urn:oasis:names:tc:SAML:2.0:protocol';
function xmlSign(
  xml: string,
  element: 'Assertion' | 'Response',
  key = fixtureKey,
) {
  const sig = new SignedXml({
    privateKey: key,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: "/*[local-name()='" + element + "']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(xml, {
    location: {
      reference: "/*[local-name()='" + element + "']/*[local-name()='Issuer']",
      action: 'after',
    },
  });
  return sig.getSignedXml();
}
export function signedSaml(
  config: SsoConfiguration,
  tx: LoginTransaction,
  change: Record<string, string | boolean> = {},
) {
  const now = Date.now();
  const issued = new Date(now - 1000).toISOString(),
    start = new Date(now - 2000).toISOString();
  const end = String(change.expires ?? new Date(now + 120000).toISOString());
  const assertionId = String(change.assertionId ?? '_' + randomUUID()),
    responseId = String(change.responseId ?? '_' + randomUUID());
  const subject = String(change.subject ?? 'exact-subject');
  const issuer = String(change.issuer ?? config.issuer),
    audience = String(change.audience ?? config.audience);
  const recipient = String(change.recipient ?? config.callbackUrl),
    inResponseTo = String(change.inResponseTo ?? tx.requestId);
  const rawAssertion =
    '<saml:Assertion xmlns:saml="' +
    A +
    '" ID="' +
    assertionId +
    '" Version="2.0" IssueInstant="' +
    issued +
    '">' +
    '<saml:Issuer>' +
    issuer +
    '</saml:Issuer><saml:Subject><saml:NameID Format="' +
    PERSISTENT_NAME_ID +
    '">' +
    subject +
    '</saml:NameID>' +
    '<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="' +
    recipient +
    '" InResponseTo="' +
    inResponseTo +
    '" NotOnOrAfter="' +
    end +
    '"/></saml:SubjectConfirmation></saml:Subject>' +
    '<saml:Conditions NotBefore="' +
    start +
    '" NotOnOrAfter="' +
    end +
    '"><saml:AudienceRestriction><saml:Audience>' +
    audience +
    '</saml:Audience></saml:AudienceRestriction></saml:Conditions>' +
    '<saml:AuthnStatement AuthnInstant="' +
    issued +
    '"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion>';
  const assertion = change.unsigned
    ? rawAssertion
    : xmlSign(rawAssertion, 'Assertion');
  const response =
    '<samlp:Response xmlns:samlp="' +
    P +
    '" xmlns:saml="' +
    A +
    '" ID="' +
    responseId +
    '" Version="2.0" IssueInstant="' +
    issued +
    '" Destination="' +
    config.callbackUrl +
    '" InResponseTo="' +
    tx.requestId +
    '">' +
    '<saml:Issuer>' +
    config.issuer +
    '</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' +
    assertion +
    '</samlp:Response>';
  return xmlSign(response, 'Response');
}
