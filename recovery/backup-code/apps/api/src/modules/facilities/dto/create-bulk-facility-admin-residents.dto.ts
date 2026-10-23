import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateFacilityAdminResidentDto } from './create-facility-admin-resident.dto';

export class CreateBulkFacilityAdminResidentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateFacilityAdminResidentDto)
  residents!: CreateFacilityAdminResidentDto[];
}
