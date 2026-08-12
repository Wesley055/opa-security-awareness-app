import { IncidentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query for the facility incident queue.
 *
 * Every field is optional: an operator opening the console with no
 * parameters gets the live queue, newest first.
 */
export class ListFacilityIncidentsDto {
  /**
   * Exact status match. Omitted means the DEFAULT LIVE SET, which is
   * OPEN plus ACKNOWLEDGED - see FacilitiesService for why ACKNOWLEDGED is
   * named despite having no writer today.
   *
   * Deliberately the domain concept rather than an includeClosed flag: the
   * lifecycle may gain states, and a boolean would have to be redefined
   * when it does.
   */
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  /**
   * OPAQUE. Encodes the createdAt and id of the last row of the previous
   * page - see encodeCursor in FacilitiesService.
   *
   * Validated only as a non-empty string, NOT as a UUID. An earlier draft
   * used the incident id alone with Prisma's cursor option; that resolves a
   * row by unique id regardless of the facility and status filter, so an id
   * belonging to another facility's queue would still find a position. The
   * ordering is (createdAt DESC, id DESC) and the cursor must carry both
   * halves of that boundary or it does not express it.
   *
   * A malformed value is a BadRequest from the service, not a silent first
   * page: quietly restarting a queue an operator is paging through would
   * show them the same emergencies twice and hide the ones below.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  /**
   * Page size. Default 25, hard ceiling 100.
   *
   * @Type is required because query parameters arrive as strings and
   * @IsInt would otherwise reject every value.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}