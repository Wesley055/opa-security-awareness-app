import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { VerifyEnrollmentDto } from "../../modules/auth/dto/verify-enrollment.dto";
import { LoginDto } from "../../modules/auth/dto/login.dto";

const verify = (password: string) =>
  validateSync(plainToInstance(VerifyEnrollmentDto, {
    requestId: "8f6b0d5e-3c1a-4b8e-9f2d-1a2b3c4d5e6f", emailCode: "0421", phoneCode: "9876", password, accept: true,
  })).filter((e) => e.property === "password");

describe("password rule", () => {
  it.each(["abcdef12", "Lagos#2026", "pass word 1", "a".repeat(63) + "1"])("accepts %s", (p) => {
    expect(verify(p)).toHaveLength(0);
  });
  it.each([
    ["too short", "abc12"],
    ["letters only", "abcdefgh"],
    ["digits only", "12345678"],
    ["too long", "a".repeat(64) + "1"],
  ])("rejects %s with one plain message", (_l, p) => {
    const errors = verify(p);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0]!.constraints!)).toContain(
      "Use 8 to 64 characters, with letters and at least one number or symbol.",
    );
  });
  it("lets existing accounts sign in with any password of 8 or more", () => {
    const errors = validateSync(plainToInstance(LoginDto, { email: "a@b.co", password: "Lagos#2026longer" }));
    expect(errors).toHaveLength(0);
  });
});
