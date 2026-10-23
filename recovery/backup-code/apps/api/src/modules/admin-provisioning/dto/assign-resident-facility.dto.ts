import { IsUUID } from 'class-validator';

export class AssignResidentFacilityDto {
  @IsUUID()
  facilityId!: string;
}
