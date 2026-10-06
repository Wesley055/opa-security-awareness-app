import { enrollmentDestination } from "./enrollment-navigation";
describe("enrollment navigation", () => {
  it("contains only the public request reference", () => {
    const url = new URL(
      enrollmentDestination(
        "https://console.example.test",
        "request-reference",
      ),
    );
    expect(url.pathname).toBe("/enroll");
    expect([...url.searchParams.entries()]).toEqual([
      ["requestId", "request-reference"],
    ]);
  });
  it("allows explicit HTTP loopback only in development", () => {
    expect(
      enrollmentDestination(
        "http://localhost:3003",
        "reference",
        "development",
      ),
    ).toBe("http://localhost:3003/enroll?requestId=reference");
    expect(() =>
      enrollmentDestination("http://example.test", "reference", "development"),
    ).toThrow();
    for (const environment of ["staging", "production"])
      expect(() =>
        enrollmentDestination(
          "http://localhost:3003",
          "reference",
          environment,
        ),
      ).toThrow();
  });
  it.each([
    undefined,
    "",
    "http://localhost:3003",
    "javascript:alert(1)",
    "https://console.example.test?token=unsafe",
    "https://user:password@console.example.test",
    "https://console.example.test#fragment",
  ])("rejects unusable or unsafe configuration %s", (base) => {
    expect(() => enrollmentDestination(base, "reference")).toThrow(
      "OPA_WEB_URL",
    );
  });
});
