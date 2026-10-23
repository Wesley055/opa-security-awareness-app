import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateFacilityAdminResidentDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;
}
