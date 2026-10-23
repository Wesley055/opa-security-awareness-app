import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from "../../../../../../packages/password-policy/index.cjs";
import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
} from "class-validator";

export class ActivateProvisionedUserDto {
  /**
   * The RAW activation token, in the body rather than the URL.
   *
   * No length or format decorator beyond non-empty: the token is compared
   * by SHA-256 digest against a unique column, so a malformed value simply
   * fails to match. Validating its shape here would tell an attacker what
   * shape to guess.
   */
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  reference?: string;

  // New passwords use the shared interactive password policy.
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}
