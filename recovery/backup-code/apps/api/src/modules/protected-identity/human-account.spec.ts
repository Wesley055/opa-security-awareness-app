import { humanAccount } from "./human-account";
describe("human-safe authorized account projection", () => {
  it("masks names and gives distinct stable labels without contact data", () => {
    const person = {
      id: "one",
      firstName: "Erick",
      lastName: "Hall",
      role: "TECHNICAL_SUPPORT",
    };
    const result = humanAccount(person);
    expect(result.displayIdentity).toMatch(/^E••• H••• · Account /);
    expect(result).not.toHaveProperty("firstName");
    expect(result).not.toHaveProperty("lastName");
    expect(humanAccount(person)).toEqual(result);
    expect(humanAccount({ ...person, id: "two" }).displayIdentity).not.toBe(
      result.displayIdentity,
    );
  });
});
