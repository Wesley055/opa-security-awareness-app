import { SamlProtocolVerifier, strictSamlXml } from './saml-protocol-verifier';
import { protocolFixture, signedSaml } from '../../../test/sso/fixtures';
import { SSO_FAILED } from './sso.policy';
describe('SAML production cryptography', () => {
  it('verifies signed response and assertion; extracts both replay identifiers', async () => {
    const f = protocolFixture('SAML2');
    const result = await new SamlProtocolVerifier().verify(
      f.config,
      f.tx,
      Buffer.from(signedSaml(f.config, f.tx)).toString('base64'),
    );
    expect(result.subject).toBe('exact-subject');
    expect(result.responseId).toMatch(/^_/);
    expect(result.samlResponseId).toMatch(/^_/);
  });
  it.each([
    ['issuer', { issuer: 'https://other.example.test' }],
    ['audience', { audience: 'other' }],
    ['recipient', { recipient: 'https://evil.example.test' }],
    ['InResponseTo', { inResponseTo: '_other' }],
    ['expiry', { expires: '2000-01-01T00:00:00.000Z' }],
    ['unsigned assertion', { unsigned: true }],
  ])('rejects signed wrong %s', async (_label, change) => {
    const f = protocolFixture('SAML2');
    await expect(
      new SamlProtocolVerifier().verify(
        f.config,
        f.tx,
        Buffer.from(signedSaml(f.config, f.tx, change)).toString('base64'),
      ),
    ).rejects.toThrow(SSO_FAILED);
  });
  it.each([
    'signature',
    'wrapping',
    'duplicate',
    'algorithm',
    'malformed',
    'doctype',
  ])('rejects %s', async (mode) => {
    const f = protocolFixture('SAML2');
    let xml = signedSaml(f.config, f.tx);
    if (mode === 'signature')
      xml = xml.replace('exact-subject', 'forged-subject');
    if (mode === 'wrapping')
      xml = xml.replace(
        '</samlp:Response>',
        '<saml:Assertion ID="_wrapped"/></samlp:Response>',
      );
    if (mode === 'duplicate')
      xml = xml.replace(
        '</samlp:Response>',
        '<saml:Attribute ID="' +
          strictSamlXml(xml).documentElement!.getAttribute('ID') +
          '"/></samlp:Response>',
      );
    if (mode === 'algorithm') xml = xml.replace('rsa-sha256', 'rsa-sha1');
    if (mode === 'malformed') xml = xml.slice(0, -10);
    if (mode === 'doctype')
      xml =
        '<!DOCTYPE Response [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml;
    await expect(
      new SamlProtocolVerifier().verify(
        f.config,
        f.tx,
        Buffer.from(xml).toString('base64'),
      ),
    ).rejects.toThrow(SSO_FAILED);
  });
  it('rejects excessive size and depth', () => {
    expect(() => strictSamlXml('<a>' + 'x'.repeat(65536) + '</a>')).toThrow();
    expect(() => strictSamlXml('<a>'.repeat(33) + '</a>'.repeat(33))).toThrow();
  });
});
