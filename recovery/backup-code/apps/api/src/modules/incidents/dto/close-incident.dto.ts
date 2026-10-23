import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for closing an incident - resolving or cancelling it.
 *
 * `reason` is free text rather than an enum on purpose for this first pass:
 * nobody has yet established what the reason vocabulary should be, and
 * inventing one now would freeze a guess into the API. It is recorded on the
 * timeline event verbatim and nothing branches on it.
 */
export class CloseIncidentDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}
