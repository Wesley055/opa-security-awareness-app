import { IsNewPassword } from "../../../shared/security/password-policy";
import {
  IsString,
  MinLength,
  MaxLength,
  IsBoolean,
  Equals,
} from "class-validator";
export class VerifyEnrollmentDto {
  @IsString() @MinLength(6) @MaxLength(64) requestId!: string; // full id or OPA-XXXXXX
  @IsString() @MaxLength(100) emailCode!: string;
  @IsString() @MaxLength(100) phoneCode!: string;
  @IsNewPassword() password!: string;
  @IsBoolean() @Equals(true) accept!: boolean;
}
export class AcceptEnrollmentDto {
  @IsString() @MinLength(6) @MaxLength(64) requestId!: string; // full id or OPA-XXXXXX
  @IsString() @MaxLength(100) acceptanceToken!: string;
}

export class ContinueEnrollmentDto {
  @IsString() @MinLength(6) @MaxLength(64) requestId!: string; // full id or OPA-XXXXXX
}
