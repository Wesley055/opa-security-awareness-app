import { Injectable } from '@nestjs/common';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { CacheProvider } from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';
import { X509Certificate } from 'crypto';
type XmlElement = Element;
type XmlDocument = Document;
import type {
  LoginTransaction,
  ProtocolVerifier,
  SsoConfiguration,
  VerifiedAssertion,
} from './sso.contracts';
import { PERSISTENT_NAME_ID, SsoDenied, validateAssertion } from './sso.policy';

const P = 'urn:oasis:names:tc:SAML:2.0:protocol';
const A = 'urn:oasis:names:tc:SAML:2.0:assertion';
const D = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const RSA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
function fail(): never {
  throw new SsoDenied();
}
export function elements(
  parent: XmlElement,
  ns: string,
  name: string,
): XmlElement[] {
  return Array.from(parent.childNodes).filter(
    (node): node is XmlElement =>
      node.nodeType === 1 &&
      (node as XmlElement).namespaceURI === ns &&
      (node as XmlElement).localName === name,
  );
}
function one(parent: XmlElement, ns: string, name: string): XmlElement {
  const children = elements(parent, ns, name);
  return children.length === 1 ? children[0]! : fail();
}
function text(element: XmlElement): string {
  if (Array.from(element.childNodes).some((n) => n.nodeType !== 3)) fail();
  const value = element.textContent ?? '';
  if (!value || value.length > 2048) fail();
  return value;
}
/** Preflight only: DOM parsing is delegated, no XML signature math here. */
export function strictSamlXml(xml: string): XmlDocument {
  if (
    Buffer.byteLength(xml) > 65536 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    xml.includes(String.fromCharCode(0))
  )
    fail();
  const doc = new DOMParser({
    errorHandler: { warning: fail, error: fail, fatalError: fail },
  }).parseFromString(xml, 'text/xml');
  if (
    !doc.documentElement ||
    Array.from(doc.childNodes).filter((n) => n.nodeType === 1).length !== 1
  )
    fail();
  const stack: Array<{ node: XmlElement; depth: number }> = [
    { node: doc.documentElement, depth: 1 },
  ];
  const ids = new Set<string>();
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++count > 2000 || depth > 32 || node.attributes.length > 24) fail();
    for (const attr of Array.from(node.attributes)) {
      if (attr.value.length > 8192) fail();
      if (attr.localName?.toLowerCase() === 'id') {
        if (
          attr.name !== 'ID' ||
          !/^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/.test(attr.value) ||
          ids.has(attr.value)
        )
          fail();
        ids.add(attr.value);
      }
    }
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1)
        stack.push({ node: child as XmlElement, depth: depth + 1 });
      else if (child.nodeType !== 3) fail(); // No comments, CDATA, entities or processing instructions in content.
    }
  }
  return doc;
}
function signaturePolicy(parent: XmlElement) {
  const signature = one(parent, D, 'Signature');
  const signedInfo = one(signature, D, 'SignedInfo');
  if (
    one(signedInfo, D, 'CanonicalizationMethod').getAttribute('Algorithm') !==
      C14N ||
    one(signedInfo, D, 'SignatureMethod').getAttribute('Algorithm') !== RSA256
  )
    fail();
  const reference = one(signedInfo, D, 'Reference');
  if (
    reference.getAttribute('URI') !== '#' + parent.getAttribute('ID') ||
    one(reference, D, 'DigestMethod').getAttribute('Algorithm') !== SHA256
  )
    fail();
  const transforms = elements(one(reference, D, 'Transforms'), D, 'Transform');
  if (
    transforms.length !== 2 ||
    transforms[0]!.getAttribute('Algorithm') !== D + 'enveloped-signature' ||
    transforms[1]!.getAttribute('Algorithm') !== C14N ||
    transforms.some((t) => t.childNodes.length !== 0)
  )
    fail();
  // Embedded KeyInfo is not a trust source; reject remote key retrieval.
  // Node-SAML uses OPA's pinned certificate registry, never request-supplied keys.
  const infos = elements(signature, D, 'KeyInfo');
  if (infos.length > 1) fail();
  if (signature.getElementsByTagNameNS(D, 'RetrievalMethod').length) fail();
}
@Injectable()
export class SamlProtocolVerifier implements ProtocolVerifier {
  private client(
    config: SsoConfiguration,
    tx: LoginTransaction,
    cache: CacheProvider,
  ) {
    if (
      !config.trust.certificates?.length ||
      config.trust.certificates.length > 3 ||
      !tx.requestId
    )
      fail();
    for (const pem of config.trust.certificates) {
      const certificate = new X509Certificate(pem);
      if (
        certificate.publicKey.asymmetricKeyType !== 'rsa' ||
        (certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) <
          2048 ||
        Date.parse(certificate.validFrom) > Date.now() ||
        Date.parse(certificate.validTo) <= Date.now()
      )
        fail();
    }
    return new SAML({
      issuer: config.audience,
      callbackUrl: config.callbackUrl,
      entryPoint: config.trust.authorizationEndpoint,
      idpCert: config.trust.certificates,
      audience: config.audience,
      idpIssuer: config.issuer,
      identifierFormat: PERSISTENT_NAME_ID,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      validateInResponseTo: ValidateInResponseTo.always,
      acceptedClockSkewMs: 0,
      maxAssertionAgeMs: 300000,
      requestIdExpirationPeriodMs: 300000,
      generateUniqueId: () => tx.requestId!,
      cacheProvider: cache,
      allowCreate: false,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
    });
  }
  /** Adapter cache is a view of the durable transaction, not production replay authority.
   * Node-SAML get/remove are not atomic. Completion consumes PostgreSQL uniqueness
   * and transaction state atomically, so concurrent verification cannot mint two sessions. */
  private correlation(tx: LoginTransaction): CacheProvider {
    return {
      saveAsync: async (key, value) =>
        key === tx.requestId ? { value, createdAt: tx.createdAt } : fail(),
      getAsync: async (key) =>
        key === tx.requestId && tx.expiresAt > Date.now()
          ? new Date(tx.createdAt).toISOString()
          : null,
      removeAsync: async (key) => (key === tx.requestId ? key : null),
    };
  }
  async initiate(
    config: SsoConfiguration,
    tx: LoginTransaction,
    state: string,
  ): Promise<string> {
    return this.client(config, tx, this.correlation(tx)).getAuthorizeUrlAsync(
      state,
      undefined,
      {},
    );
  }
  async verify(
    config: SsoConfiguration,
    tx: LoginTransaction,
    raw: unknown,
  ): Promise<VerifiedAssertion> {
    try {
      if (
        config.providerType !== 'SAML2' ||
        typeof raw !== 'string' ||
        raw.length > 90000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)
      )
        fail();
      const bytes = Buffer.from(raw, 'base64');
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const doc = strictSamlXml(xml);
      const root = doc.documentElement!;
      if (
        root.namespaceURI !== P ||
        root.localName !== 'Response' ||
        root.getAttribute('Version') !== '2.0' ||
        root.getAttribute('Destination') !== config.callbackUrl ||
        root.getAttribute('InResponseTo') !== tx.requestId ||
        text(one(root, A, 'Issuer')) !== config.issuer ||
        !root.getAttribute('ID')
      )
        fail();
      const responseId = root.getAttribute('ID')!;
      if (
        one(one(root, P, 'Status'), P, 'StatusCode').getAttribute('Value') !==
        'urn:oasis:names:tc:SAML:2.0:status:Success'
      )
        fail();
      const untrustedAssertion = one(root, A, 'Assertion');
      if (
        doc.getElementsByTagNameNS(A, 'Assertion').length !== 1 ||
        doc.getElementsByTagNameNS(D, 'Signature').length !== 2 ||
        doc.getElementsByTagNameNS(A, 'EncryptedAssertion').length
      )
        fail();
      signaturePolicy(root);
      signaturePolicy(untrustedAssertion);
      const result = await this.client(
        config,
        tx,
        this.correlation(tx),
      ).validatePostResponseAsync({ SAMLResponse: raw });
      if (!result.profile?.getAssertionXml || result.loggedOut) fail();
      // Only this signed-reference-derived document supplies external identity.
      const assertion = strictSamlXml(
        result.profile.getAssertionXml(),
      ).documentElement!;
      if (
        assertion.namespaceURI !== A ||
        assertion.localName !== 'Assertion' ||
        assertion.getAttribute('Version') !== '2.0'
      )
        fail();
      const subject = one(assertion, A, 'Subject');
      const nameId = one(subject, A, 'NameID');
      if (
        nameId.getAttribute('Format') !== PERSISTENT_NAME_ID ||
        (nameId.hasAttribute('NameQualifier') &&
          nameId.getAttribute('NameQualifier') !== config.issuer) ||
        (nameId.hasAttribute('SPNameQualifier') &&
          nameId.getAttribute('SPNameQualifier') !== config.audience)
      )
        fail();
      const confirmation = one(subject, A, 'SubjectConfirmation');
      if (
        confirmation.getAttribute('Method') !==
        'urn:oasis:names:tc:SAML:2.0:cm:bearer'
      )
        fail();
      const data = one(confirmation, A, 'SubjectConfirmationData');
      if (
        data.getAttribute('Recipient') !== config.callbackUrl ||
        data.getAttribute('InResponseTo') !== tx.requestId
      )
        fail();
      const conditions = one(assertion, A, 'Conditions');
      const restrictions = elements(conditions, A, 'AudienceRestriction');
      if (
        !restrictions.length ||
        restrictions.some(
          (r) =>
            !elements(r, A, 'Audience').some(
              (a) => text(a) === config.audience,
            ),
        )
      )
        fail();
      const authn = one(assertion, A, 'AuthnStatement');
      const issue = Date.parse(assertion.getAttribute('IssueInstant') ?? '');
      const start = Date.parse(conditions.getAttribute('NotBefore') ?? '');
      const expires = Math.min(
        Date.parse(conditions.getAttribute('NotOnOrAfter') ?? ''),
        Date.parse(data.getAttribute('NotOnOrAfter') ?? ''),
        authn.hasAttribute('SessionNotOnOrAfter')
          ? Date.parse(authn.getAttribute('SessionNotOnOrAfter')!)
          : Infinity,
      );
      const verified: VerifiedAssertion = {
        providerType: 'SAML2',
        issuer: text(one(assertion, A, 'Issuer')),
        subject: text(nameId),
        subjectFormat: PERSISTENT_NAME_ID,
        audiences: [config.audience],
        issuedAt: issue,
        notBefore: start,
        expiresAt: expires,
        responseId: assertion.getAttribute('ID') ?? '',
        samlResponseId: responseId,
        inResponseTo: data.getAttribute('InResponseTo') ?? '',
        recipient: data.getAttribute('Recipient') ?? '',
      };
      validateAssertion(config, tx, verified, Date.now());
      return verified;
    } catch {
      throw new SsoDenied();
    }
  }
}
