import { IsEmail, IsNotEmpty, IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsPhoneNumber('NG')
  phoneNumber!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;
}