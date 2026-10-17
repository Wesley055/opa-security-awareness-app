import { IsNewPassword } from "../../../shared/security/password-policy";
import {
  IsString,
  IsUUID,
  MinLength,
  MaxLength,
  IsBoolean,
  Equals,
} from "class-validator";
export class VerifyEnrollmentDto {
  @IsUUID() requestId!: string;
  @IsString() @MaxLength(100) emailCode!: string;
  @IsString() @MaxLength(100) phoneCode!: string;
  @IsNewPassword() password!: string;
  @IsBoolean() @Equals(true) accept!: boolean;
}
export class AcceptEnrollmentDto {
  @IsUUID() requestId!: string;
  @IsString() @MaxLength(100) acceptanceToken!: string;
}

export class ContinueEnrollmentDto {
  @IsUUID() requestId!: string;
}
