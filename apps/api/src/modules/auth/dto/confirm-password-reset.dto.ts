import { IsNewPassword } from "../../../shared/security/password-policy";
import { IsString, MinLength } from 'class-validator';

export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(32)
  token!: string;

  @IsNewPassword()
  password!: string;
}
