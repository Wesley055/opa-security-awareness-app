import { validate } from "class-validator";
import { isNewPasswordValid } from "../../../../../packages/password-policy/index.cjs";
import { ActivateProvisionedUserDto } from "./dto/activate-provisioned-user.dto";
import { ConfirmPasswordResetDto } from "./dto/confirm-password-reset.dto";
import { VerifyEnrollmentDto } from "./dto/verify-enrollment.dto";
import { LoginDto } from "./dto/login.dto";
describe("interactive password policy", () => {
  it.each(["x".repeat(7), "x".repeat(8), "x".repeat(12), "x".repeat(13), "😀".repeat(4), "😀".repeat(8), "😀".repeat(12), "😀".repeat(13), "✈️".repeat(8)])(
    "API and shared UI policy agree for %s",
    async (password) => {
      for (const Type of [
        ActivateProvisionedUserDto,
        ConfirmPasswordResetDto,
        VerifyEnrollmentDto,
      ]) {
        const errors = await validate(Object.assign(new Type(), { password }));
        expect(errors.some((e) => e.property === "password")).toBe(
          !isNewPasswordValid(password),
        );
      }
    },
  );
  it.each([8, 12, 13, 48])(
    "login preserves an existing password of length %i",
    async (length) => {
      expect(
        await validate(
          Object.assign(new LoginDto(), {
            email: "user@example.test",
            password: "x".repeat(length),
          }),
        ),
      ).toHaveLength(0);
    },
  );
  it("login rejects an empty password", async () => {
    expect(
      (
        await validate(
          Object.assign(new LoginDto(), {
            email: "user@example.test",
            password: "",
          }),
        )
      ).some((e) => e.property === "password"),
    ).toBe(true);
  });
});
