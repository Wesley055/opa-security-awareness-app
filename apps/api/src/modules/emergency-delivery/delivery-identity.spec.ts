import { callbackSourceAllowed, callbackTokenMatches, msisdnHash } from "./delivery-identity";

afterEach(() => {
  delete process.env.AFRICASTALKING_CALLBACK_TOKEN;
  delete process.env.AFRICASTALKING_CALLBACK_IPS;
});

it("requires a long configured callback token and matches it exactly", () => {
  expect(callbackTokenMatches("anything")).toBe(false);
  process.env.AFRICASTALKING_CALLBACK_TOKEN = "short";
  expect(callbackTokenMatches("short")).toBe(false);
  process.env.AFRICASTALKING_CALLBACK_TOKEN = "x".repeat(40);
  expect(callbackTokenMatches("x".repeat(40))).toBe(true);
  expect(callbackTokenMatches("x".repeat(39) + "y")).toBe(false);
  expect(callbackTokenMatches(undefined)).toBe(false);
});

it("enforces the source allowlist only when configured", () => {
  expect(callbackSourceAllowed("1.2.3.4")).toBe(true);
  process.env.AFRICASTALKING_CALLBACK_IPS = "5.6.7.8, 9.9.9.9";
  expect(callbackSourceAllowed("::ffff:5.6.7.8")).toBe(true);
  expect(callbackSourceAllowed("1.2.3.4")).toBe(false);
  expect(callbackSourceAllowed(undefined)).toBe(false);
});

it("hashes numbers with the lookup key, never storing them", () => {
  const h = msisdnHash("k", "+2348031234567");
  expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(h).not.toContain("2348031234567");
  expect(msisdnHash("other", "+2348031234567")).not.toBe(h);
});
