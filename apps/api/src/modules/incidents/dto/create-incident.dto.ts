import { IncidentTrigger } from '@prisma/client';
import { IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIncidentDto {
  @IsEnum(IncidentTrigger)
  trigger!: IncidentTrigger;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  voicePhrase?: string;
}