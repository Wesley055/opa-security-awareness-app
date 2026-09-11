import { describe, it, expect, vi, afterEach } from "vitest";
import { environmentApiUrl } from "./environment-api";
afterEach(() => vi.unstubAllEnvs());
describe("website environment API boundary", () => {
  it("rejects missing environment", () => {
    vi.stubEnv("OPA_ENVIRONMENT", "");
    vi.stubEnv("OPA_API_URL", "https://production.example.test");
    expect(environmentApiUrl()).toBeNull();
  });
  it("staging cannot use production origin without staging verification", () => {
    vi.stubEnv("OPA_ENVIRONMENT", "staging");
    vi.stubEnv("OPA_API_URL", "https://production.example.test");
    expect(environmentApiUrl()).toBeNull();
  });
  it("explicit development keeps local configuration", () => {
    vi.stubEnv("OPA_ENVIRONMENT", "development");
    vi.stubEnv("OPA_API_URL", "http://fixture.test:3000");
    expect(environmentApiUrl()).toBe("http://fixture.test:3000");
  });
});
