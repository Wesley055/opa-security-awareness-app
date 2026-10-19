import {
  enrollmentReference,
  newEnrollmentRequestId,
  parseEnrollmentReference,
  resolveEnrollmentReference,
} from "./enrollment-reference";

const ID = "3f9a1c2e-7b4d-4e1a-9c3b-2d5e6f708192";
const tx = (rows: { id: string }[]) => ({ $queryRaw: jest.fn().mockResolvedValue(rows) }) as never;

describe("enrollment reference", () => {
  it("is short and typeable", () => {
    expect(enrollmentReference(ID)).toBe("OPA-3F9A1C");
  });
  it("accepts the ways people type it", () => {
    for (const v of ["OPA-3F9A1C", "opa-3f9a1c", " OPA 3F9A1C ", "3f9a1c", "3F9-A1C"])
      expect(parseEnrollmentReference(v)).toEqual({ prefix: "3f9a1c" });
    expect(parseEnrollmentReference(ID.toUpperCase())).toEqual({ id: ID });
  });
  it("rejects anything else", () => {
    for (const v of ["", "OPA-3F9A1", "OPA-3F9A1CZ", "OPA-ZZZZZZ", 123, null])
      expect(parseEnrollmentReference(v)).toBeNull();
  });
  it("resolves one live invitation, never guesses between two", async () => {
    expect(await resolveEnrollmentReference(tx([{ id: ID }]), "OPA-3F9A1C")).toBe(ID);
    expect(await resolveEnrollmentReference(tx([{ id: ID }, { id: ID }]), "OPA-3F9A1C")).toBeNull();
    expect(await resolveEnrollmentReference(tx([]), "OPA-3F9A1C")).toBeNull();
    const t = tx([]);
    expect(await resolveEnrollmentReference(t, ID)).toBe(ID);
    expect((t as unknown as { $queryRaw: jest.Mock }).$queryRaw).not.toHaveBeenCalled();
  });
  it("new ids avoid references already in use", async () => {
    const q = jest.fn().mockResolvedValueOnce([{ id: ID }]).mockResolvedValue([]);
    const id = await newEnrollmentRequestId({ $queryRaw: q } as never);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(q).toHaveBeenCalledTimes(2);
  });
});
