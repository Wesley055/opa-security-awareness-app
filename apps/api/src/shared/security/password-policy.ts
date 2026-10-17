import { applyDecorators } from "@nestjs/common";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";

/**
 * One rule for every password a person chooses: 8 to 64 characters, with
 * letters and at least one number or symbol. No upper limit tighter than 64,
 * so passphrases and password managers work.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
export const PASSWORD_RULE_TEXT =
  "Use 8 to 64 characters, with letters and at least one number or symbol.";
const MIXED = /^(?=.*\p{L})(?=.*[\p{N}\p{P}\p{S}]).*$/u;

export function IsNewPassword() {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_TEXT }),
    MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_RULE_TEXT }),
    Matches(MIXED, { message: PASSWORD_RULE_TEXT }),
  );
}
