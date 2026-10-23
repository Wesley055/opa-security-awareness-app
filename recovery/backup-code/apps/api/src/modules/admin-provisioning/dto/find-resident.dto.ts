import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * One identifier for a resident lookup.
 *
 * BOTH FIELDS ARE OPTIONAL HERE AND THE SERVICE ENFORCES EXACTLY ONE.
 * class-validator has no XOR, so expressing it at this level would need a
 * custom ValidatorConstraint class - a new abstraction for one invariant.
 * AdminProvisioningService.findResident rejects neither-or-both with a
 * BadRequest, and a spec pins all four combinations.
 *
 * This comment says where the rule lives rather than claiming the shape
 * enforces it. An earlier draft asserted "exactly one of email or
 * phoneNumber" here while both fields were independently optional, which
 * read as true and was not.
 *
 * NO PHONE FORMAT DECORATOR, matching RegisterDto. toE164 in the service is
 * the single validation authority for phone numbers in this codebase; a
 * second validator here would be free to disagree with it, which is exactly
 * how the old Nigeria-only restriction survived unnoticed.
 */
export class FindResidentDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phoneNumber?: string;
}