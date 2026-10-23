import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { EvidenceType } from '@prisma/client';

export class UploadEvidenceDto {
  @IsEnum(EvidenceType)
  type!: EvidenceType;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}