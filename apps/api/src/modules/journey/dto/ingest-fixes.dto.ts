import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Capture modes a DEVICE may claim. activation and retrigger are reserved
 * for the SOS path and are deliberately not accepted on the wire.
 */
export const TRACKED_SOURCES = ['foreground', 'background', 'manual'] as const;
export type TrackedSource = (typeof TRACKED_SOURCES)[number];

/** One fix as it arrives from a device. */
export class JourneyFixDto {
  /** Client-generated, per fix. Column is VarChar(128). */
  @IsString()
  @Length(1, 128)
  idempotencyKey!: string;

  @IsIn(TRACKED_SOURCES)
  source!: TrackedSource;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  /**
   * iOS CLLocation.course is -1 whenever course is invalid, which INCLUDES
   * a stationary device. Without this transform a panic button fails
   * validation for someone standing still. Transform runs during
   * plainToInstance, so it lands before Min(0) sees the value.
   */
  @IsOptional()
  @Transform(({ value }) => (value === -1 ? null : value))
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  @IsOptional()
  @IsBoolean()
  isCharging?: boolean;

  /** Device clock. Strict here, unlike the SOS path - see D11. */
  @IsISO8601()
  recordedAt!: string;
}

export class IngestFixesDto {
  @IsUUID()
  sessionId!: string;

  @ValidateNested({ each: true })
  @Type(() => JourneyFixDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  fixes!: JourneyFixDto[];
}
