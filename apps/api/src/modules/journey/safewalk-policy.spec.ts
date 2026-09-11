import {
  deadlines,
  responseDeadline,
  guardianScopeAllowed,
  OWNER_CHECK_MESSAGE,
  GUARDIAN_OVERDUE_MESSAGE,
} from "./safewalk-policy";
import type { SafeWalkScope } from "./safewalk-policy";

const account = (
  id: string,
  facilityId: string | null = null,
): SafeWalkScope => ({
  id,
  facilityId,
  role: "USER",
  isActive: true,
  accountStatus: "ACTIVE",
  facility: facilityId ? { isActive: true } : null,
});

describe("SafeWalk deadline policy", () => {
  const eta = new Date("2026-09-09T10:00:00Z");
  it("places the check at +5 and nominal guardian escalation at +8", () => {
    expect(deadlines(eta)).toEqual({
      checkDueAt: new Date("2026-09-09T10:05:00Z"),
      guardianDueAt: new Date("2026-09-09T10:08:00Z"),
    });
  });
  it("gives an on-time check three minutes", () => {
    expect(
      responseDeadline(deadlines(eta).guardianDueAt, deadlines(eta).checkDueAt),
    ).toEqual(deadlines(eta).guardianDueAt);
  });
  it("preserves three minutes after a delayed prompt rather than instantly escalating after downtime", () => {
    expect(
      responseDeadline(
        deadlines(eta).guardianDueAt,
        new Date("2026-09-09T10:20:00Z"),
      ),
    ).toEqual(new Date("2026-09-09T10:23:00Z"));
  });
  it("never advances escalation before the nominal +8 deadline", () => {
    expect(responseDeadline(deadlines(eta).guardianDueAt, eta)).toEqual(
      deadlines(eta).guardianDueAt,
    );
  });
  it("uses status-only non-emergency wording", () => {
    expect(OWNER_CHECK_MESSAGE).toContain("confirm your safety");
    expect(GUARDIAN_OVERDUE_MESSAGE).toContain("non-emergency");
    expect(GUARDIAN_OVERDUE_MESSAGE).not.toMatch(
      /danger|SOS|latitude|longitude/,
    );
  });
});

describe("SafeWalk guardian scope", () => {
  it("allows explicitly paired personal accounts", () => {
    expect(
      guardianScopeAllowed(account("owner"), account("guardian"), null),
    ).toBe(true);
  });
  it("allows same-facility accounts", () => {
    expect(
      guardianScopeAllowed(
        account("owner", "a"),
        account("guardian", "a"),
        "a",
      ),
    ).toBe(true);
  });
  it.each([
    [account("owner", "a"), account("guardian", "b"), "a"],
    [account("owner", "a"), account("guardian"), "a"],
    [account("owner"), account("guardian", "a"), null],
    [account("owner", "b"), account("guardian", "b"), "a"],
    [account("owner"), account("owner"), null],
    [null, account("guardian"), null],
    [account("owner"), null, null],
    [account("owner"), { ...account("guardian"), isActive: false }, null],
    [
      account("owner"),
      { ...account("guardian"), accountStatus: "PENDING_ACTIVATION" },
      null,
    ],
    [
      account("owner", "a"),
      { ...account("guardian", "a"), facility: { isActive: false } },
      "a",
    ],
  ])(
    "fails closed for mismatched or inactive scope %j",
    (owner, guardian, scope) => {
      expect(
        guardianScopeAllowed(
          owner as SafeWalkScope | null,
          guardian as SafeWalkScope | null,
          scope as string | null,
        ),
      ).toBe(false);
    },
  );
  it.each([
    "ADMIN",
    "FACILITY_ADMIN",
    "FACILITY_OPERATOR",
    "RESPONDER",
  ] as const)("does not authorize role %s as guardian", (role) => {
    expect(
      guardianScopeAllowed(
        account("owner"),
        { ...account("guardian"), role },
        null,
      ),
    ).toBe(false);
  });
});
