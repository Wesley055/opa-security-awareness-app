import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateVisitorPassDto {
  @IsString() @MinLength(2) @MaxLength(80) visitorName!: string;
  /** Optional, E.164 (e.g. +2348012345678). Used only to show the guard and for future SMS. */
  @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/, { message: "Phone must be in international format, e.g. +2348012345678." })
  visitorPhone?: string;
  /** House, street or block. */
  @IsString() @MinLength(1) @MaxLength(120) destination!: string;
  /** Start of the visit; defaults to now. */
  @IsOptional() @IsDateString() validFrom?: string;
  /** Approved visit length; defaults to the estate setting. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(4320) expectedMinutes?: number;
}

export class GateCodeDto {
  /** Six digits; spaces and dashes are forgiven. */
  @IsString() @MaxLength(20) code!: string;
}

export class GatePassDto {
  @IsUUID() passId!: string;
}

export class GateDenyDto {
  @IsUUID() passId!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** Recorded when the system cannot verify (e.g. paper log after an outage). */
export class ManualEntryDto {
  @IsString() @MinLength(2) @MaxLength(200) note!: string;
}

export class EstateSettingsDto {
  @Type(() => Number) @IsInt() @Min(15) @Max(4320) visitorDefaultMinutes!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(720) overstayGraceMinutes!: number;
}
