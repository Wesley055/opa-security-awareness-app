import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EmergencyTriggerType,
  TriggerMode,
} from '../../emergency-detection/dto/trigger-request.dto';

export class CreateIncidentRequestDto {
  /*
   * Emergency detection
   */

  @IsEnum(EmergencyTriggerType)
  triggerType: EmergencyTriggerType;

  @IsEnum(TriggerMode)
  mode: TriggerMode;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  detectedPhrase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  profileName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  voiceConfidence?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  repetitionCount?: number;

  @IsOptional()
  @IsBoolean()
  userConfirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  cancellationReceived?: boolean;

  @IsOptional()
  @IsBoolean()
  deviceInMotion?: boolean;

  @IsOptional()
  @IsBoolean()
  isOffline?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  confirmationSeconds?: number;

  /*
   * Location
   */

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsNumber()
  altitude?: number;

  /*
   * Device information
   */

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  @IsOptional()
  @IsBoolean()
  isCharging?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  networkType?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}