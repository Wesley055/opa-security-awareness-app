import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReportScopeDto {
  @IsOptional() @IsUUID() facilityId?: string;
}
export class AggregateQueryDto extends ReportScopeDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
}
export class GenerateAirDto extends ReportScopeDto {
  @IsUUID() requestKey!: string;
}
export const ACTION_CATALOG = {
  DELIVERY_REVIEW: { title: 'Review notification delivery', description: 'Review the linked incident delivery evidence and document corrective work.' },
  RESPONSE_REVIEW: { title: 'Review incident response', description: 'Review the linked incident response timeline and document corrective work.' },
  EVIDENCE_REVIEW: { title: 'Complete incident evidence review', description: 'Review missing incident evidence and attach a completion evidence reference.' },
  PROCEDURE_REVIEW: { title: 'Review operational procedure', description: 'Review the procedure associated with this incident and record the corrective work.' },
} as const;
export class CreateActionDto extends ReportScopeDto {
  @IsUUID() requestKey!: string;
  @IsUUID() airId!: string;
  @IsUUID() ownerId!: string;
  @IsIn(Object.keys(ACTION_CATALOG)) category!: keyof typeof ACTION_CATALOG;
  @IsDateString() dueAt!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority!: string;
}
export class UpdateActionDto extends ReportScopeDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'])
  status?: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CANCELLED';
  @IsOptional() @IsUUID() completionEvidenceId?: string;
}
