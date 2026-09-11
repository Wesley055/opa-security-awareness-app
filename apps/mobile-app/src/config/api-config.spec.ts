let mockExtra: Record<string, unknown>;
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra, hostUri: "fixture.test:8081" };
    },
  },
}));
function load() {
  jest.resetModules();
  return jest.requireActual("./api-config") as { API_BASE_URL: string };
}
describe("mobile runtime environment", () => {
  it("fails with missing classification", () => {
    mockExtra = {};
    expect(load).toThrow("environment");
  });
  it("preview cannot use Metro fallback", () => {
    mockExtra = { environment: "staging" };
    expect(load).toThrow("endpoint");
  });
  it("rejects mismatched endpoint classification", () => {
    mockExtra = {
      environment: "staging",
      apiBaseUrl: "https://production.example.test",
      endpointEnvironment: "production",
      verifiedApiOrigin: "https://production.example.test",
    };
    expect(load).toThrow("mismatch");
  });
  it("accepts build-verified staging fixture", () => {
    mockExtra = {
      environment: "staging",
      endpointEnvironment: "staging",
      apiBaseUrl: "https://staging.example.test",
      verifiedApiOrigin: "https://staging.example.test",
    };
    expect(load().API_BASE_URL).toBe("https://staging.example.test");
  });
  it("permits explicit development Metro fallback only", () => {
    mockExtra = { environment: "development" };
    expect(load().API_BASE_URL).toBe("http://fixture.test:3000");
  });
});
