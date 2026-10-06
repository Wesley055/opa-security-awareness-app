import { Equals, IsEmail, IsNotEmpty, IsString } from "class-validator";

export class RegisterDto {
  @IsEmail()
  email!: string;

  // NOT the class-validator phone decorator. Its region form restricts
  // to one country - which is what this was, locked to Nigeria - and its
  // bare form demands international format, rejecting 08024662124.
  // Neither matches OPA's rule.
  //
  // toE164 in enrollment.service is the SINGLE validation authority: any
  // country by its own country code, Nigeria assumed only when none is
  // given. Two validators disagreeing about one field is how the old
  // Nigeria-only restriction survived unnoticed.
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  // Registration creates intent only; never silently discard a submitted credential.
  @Equals(undefined, {
    message:
      "Choose and confirm your password during enrollment verification/activation, not registration.",
  })
  password?: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;
}
