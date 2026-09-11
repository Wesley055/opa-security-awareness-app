import { SsoSecrets } from './sso-secrets';
import { approvedHttps, publicAddress, SsoNetwork } from './sso-network';
import { settings } from '../../../test/sso/fixtures';
describe('SSO secrets and network boundary', () => {
  it('encrypts nondeterministically with authenticated context', () => {
    const secrets = new SsoSecrets(settings);
    const a = secrets.seal('secret', 'a'),
      b = secrets.seal('secret', 'a');
    expect(a).not.toEqual(b);
    expect(JSON.stringify(a)).not.toContain('secret');
    expect(secrets.open(a, 'a')).toBe('secret');
    expect(() => secrets.open(a, 'b')).toThrow();
  });
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.0.1',
    '172.16.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '224.0.0.1',
  ])('rejects nonpublic %s', (ip) => expect(publicAddress(ip)).toBe(false));
  it('allows public IPv4', () => expect(publicAddress('8.8.8.8')).toBe(true));
  it.each([
    'http://idp.example.test',
    'https://user:pass@idp.example.test',
    'https://127.0.0.1',
    'https://idp.example.test:8443',
    'https://idp.example.test/#a',
  ])('rejects URL %s', (url) => expect(() => approvedHttps(url)).toThrow());
  it('rejects token supplied destinations before network access', async () => {
    const fetcher = new SsoNetwork().forEndpoints([
      'https://idp.example.test/jwks',
    ]);
    await expect(
      fetcher('https://evil.example.test/jwks', {
        method: 'GET',
        body: undefined,
        headers: {},
        redirect: 'manual',
      }),
    ).rejects.toThrow();
  });
});
