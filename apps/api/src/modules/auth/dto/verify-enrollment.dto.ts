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
  @IsString() @MinLength(12) @MaxLength(200) password!: string;
  @IsBoolean() @Equals(true) accept!: boolean;
}
export class AcceptEnrollmentDto {
  @IsUUID() requestId!: string;
  @IsString() @MaxLength(100) acceptanceToken!: string;
}
