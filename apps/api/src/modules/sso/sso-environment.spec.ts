import { assertSsoEnabled, assertSsoBinding } from "./sso-environment";
describe("SSO environment boundary", () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
  });
  it("staging defaults disabled", () => {
    process.env = { ...original, OPA_ENVIRONMENT: "staging" };
    delete process.env.OPA_SSO_ENABLED;
    expect(() => assertSsoEnabled()).toThrow();
  });
  it("enabled staging rejects unbound test IdP", () => {
    process.env = {
      ...original,
      OPA_ENVIRONMENT: "staging",
      OPA_SSO_ENABLED: "true",
    };
    expect(() =>
      assertSsoBinding(
        {
          providerType: "OIDC",
          issuer: "https://idp.example.test",
          audience: "fixture",
          trust: {},
        },
        "fixture",
      ),
    ).toThrow();
  });
  it("production enabled behavior retained", () => {
    process.env = { ...original, OPA_ENVIRONMENT: "production" };
    delete process.env.OPA_SSO_ENABLED;
    expect(() => assertSsoEnabled()).not.toThrow();
  });
});
