import { describe, expect, it } from "vitest";
import { parseHeadOffice } from "./organization-insight";
import { headOfficeFixture } from "./organization-insight.fixture";
const latency = { meanMs: 120000, known: 1, unknown: 1 };
describe("Head Office contract", () => {
  it("projects allowlisted aggregate figures", () => {
    const summary = parseHeadOffice(headOfficeFixture());
    expect(summary.organization.name).toBe("Demo Bank");
    expect(summary.branches[0]).toMatchObject({
      region: "Lagos",
      delivered: 3,
      providerAccepted: 1,
      overdueActions: 1,
      acknowledgement: latency,
    });
    expect(summary.totals.branches).toBe(2);
  });
  it("never copies unexpected fields such as identities", () => {
    const data = headOfficeFixture();
    (data.branches[0] as Record<string, unknown>).residentEmail =
      "private@example.test";
    expect(JSON.stringify(parseHeadOffice(data))).not.toContain("private");
  });
  it("rejects negative or missing figures instead of inventing zero", () => {
    const data = headOfficeFixture();
    data.branches[0]!.openNow = -1;
    expect(() => parseHeadOffice(data)).toThrow();
    expect(() => parseHeadOffice({ schemaVersion: 1 })).toThrow();
  });
});
