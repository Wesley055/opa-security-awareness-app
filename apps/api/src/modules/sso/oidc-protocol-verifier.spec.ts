import { OidcProtocolVerifier } from './oidc-protocol-verifier';
import {
  protocolFixture,
  SignedOidcProvider,
} from '../../../test/sso/fixtures';
import { SSO_FAILED } from './sso.policy';
describe('OIDC production cryptography', () => {
  const setup = () => {
    const f = protocolFixture();
    const provider = new SignedOidcProvider();
    return {
      ...f,
      provider,
      verifier: new OidcProtocolVerifier(f.secrets, provider.network()),
    };
  };
  it('verifies a signed code login with S256, expected nonce and state', async () => {
    const f = setup();
    const url = await f.verifier.initiate(f.config, f.tx, f.material.state);
    expect(new URL(url).searchParams.get('code_challenge_method')).toBe('S256');
    const claims = await f.verifier.verify(
      f.config,
      f.tx,
      f.provider.accept(url),
    );
    expect(claims.subject).toBe('exact-subject');
    expect(f.provider.jwksReads).toBe(1);
  });
  it.each([
    ['wrong issuer', { iss: 'https://evil.example.test' }],
    ['wrong audience', { aud: 'other' }],
    ['wrong azp', { azp: 'other' }],
    ['wrong nonce', { nonce: 'other' }],
    ['expired token', { exp: 1 }],
    ['future nbf', { nbf: 9999999999 }],
    ['future iat', { iat: 9999999999 }],
    [
      'email without subject',
      { sub: undefined, email: 'exact-subject@example.test' },
    ],
  ])('rejects signed %s', async (_label, claims) => {
    const f = setup();
    f.provider.claims = claims;
    const url = await f.verifier.initiate(f.config, f.tx, f.material.state);
    await expect(
      f.verifier.verify(f.config, f.tx, f.provider.accept(url)),
    ).rejects.toThrow(SSO_FAILED);
  });
  it.each(['signature', 'key', 'state', 'pkce'])(
    'rejects invalid %s',
    async (mode) => {
      const f = setup();
      const url = await f.verifier.initiate(f.config, f.tx, f.material.state);
      let callback = f.provider.accept(url);
      if (mode === 'signature') f.provider.badSignature = true;
      if (mode === 'key') f.provider.kidOverride = 'unknown';
      if (mode === 'state')
        callback = callback.replace(f.material.state, 'wrong');
      if (mode === 'pkce')
        f.tx.pkceVerifier = f.secrets.seal(
          'incorrect-verifier',
          'pkce:' + f.tx.id,
        );
      await expect(f.verifier.verify(f.config, f.tx, callback)).rejects.toThrow(
        SSO_FAILED,
      );
    },
  );
  it('rejects authorization-code replay', async () => {
    const f = setup();
    const callback = f.provider.accept(
      await f.verifier.initiate(f.config, f.tx, f.material.state),
    );
    await f.verifier.verify(f.config, f.tx, callback);
    await expect(f.verifier.verify(f.config, f.tx, callback)).rejects.toThrow(
      SSO_FAILED,
    );
  });
  it('refreshes JWKS for a rotated key after the library cooldown', async () => {
    const f = setup();
    const login = async () =>
      f.verifier.verify(
        f.config,
        f.tx,
        f.provider.accept(
          await f.verifier.initiate(f.config, f.tx, f.material.state),
        ),
      );
    await login();
    f.provider.published = [1];
    f.provider.signing = 1;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    try {
      expect((await login()).subject).toBe('exact-subject');
      expect(f.provider.jwksReads).toBe(2);
    } finally {
      clock.mockRestore();
    }
  }, 40000);
  it('invalidates discovery cache on configuration revision change', async () => {
    const f = setup();
    await f.verifier.initiate(f.config, f.tx, f.material.state);
    f.config.revision++;
    f.tx.configurationRevision++;
    await f.verifier.initiate(f.config, f.tx, f.material.state);
    expect(f.provider.discoveryReads).toBe(2);
  });
});
