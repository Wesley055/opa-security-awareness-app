import { IsNotEmpty, IsString, MinLength } from 'class-validator';

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

  // Same minimum as RegisterDto. A provisioned account password protects
  // access to safety workflows, so it must not be held to a weaker rule than a
  // consumer account.
  @IsString()
  @MinLength(12)
  password!: string;
}
