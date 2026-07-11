import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum EmergencyTriggerType {
  SOS_BUTTON = 'SOS_BUTTON',
  VOICE = 'VOICE',
  SILENT = 'SILENT',
  SAFETY_CHECK = 'SAFETY_CHECK',
  TRUSTED_CONTACT = 'TRUSTED_CONTACT',
  SYSTEM_TEST = 'SYSTEM_TEST',
}

export enum TriggerMode {
  IMMEDIATE = 'IMMEDIATE',
  CONFIRMATION = 'CONFIRMATION',
  SILENT = 'SILENT',
}

export class TriggerRequestDto {
  @IsEnum(EmergencyTriggerType)
  triggerType: EmergencyTriggerType;

  @IsEnum(TriggerMode)
  mode: TriggerMode;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
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
}