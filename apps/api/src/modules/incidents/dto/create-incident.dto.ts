import { IncidentTrigger } from '@prisma/client';
import { IsEnum, IsLatitude, ValidateIf, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIncidentDto {
  @IsEnum(IncidentTrigger)
  trigger!: IncidentTrigger;

  // Omitted as a pair only; null, partial, and invalid pairs still fail.
  @ValidateIf((dto) => dto.latitude !== undefined || dto.longitude !== undefined)
  @IsLatitude()
  latitude?: number;

  @ValidateIf((dto) => dto.latitude !== undefined || dto.longitude !== undefined)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  voicePhrase?: string;
}