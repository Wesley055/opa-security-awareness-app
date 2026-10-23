import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from "../../../../../../packages/password-policy/index.cjs";
import {
  IsString,
  MinLength,
  MaxLength,
  IsBoolean,
  Equals,
} from "class-validator";
export class VerifyEnrollmentDto {
  @IsString() @MaxLength(512) requestId!: string;
  @IsString() @MaxLength(100) emailCode!: string;
  @IsString() @MaxLength(100) phoneCode!: string;
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
  @IsBoolean() @Equals(true) accept!: boolean;
}
export class AcceptEnrollmentDto {
  @IsString() @MaxLength(512) requestId!: string;
  @IsString() @MaxLength(100) acceptanceToken!: string;
}

export class ContinueEnrollmentDto {
  @IsString() @MaxLength(512) requestId!: string;
}
