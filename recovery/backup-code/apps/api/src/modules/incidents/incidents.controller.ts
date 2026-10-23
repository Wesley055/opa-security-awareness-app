import { IsIn, IsString, IsUUID, Length } from "class-validator";
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { JwtPayload } from "../auth/jwt.strategy";
import { CloseIncidentDto } from "./dto/close-incident.dto";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { IncidentsService } from "./incidents.service";

class InstitutionalResolutionDto {
  @IsString() @Length(1, 500) reason!: string;
  @IsUUID() caseReference!: string;
  @IsUUID() correlationId!: string;
}
class OperationalEventDto {
  @IsIn(["SEEN", "ACKNOWLEDGED", "DISPATCHED", "RESPONSE_PROGRESS", "ESCALATION"]) type!:
    "SEEN" | "ACKNOWLEDGED" | "DISPATCHED" | "RESPONSE_PROGRESS" | "ESCALATION";
  @IsString() @Length(1, 500) note!: string;
  @IsUUID() correlationId!: string;
}
type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller("incidents")
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post(":incidentId/institutional-resolution")
  resolveInstitutional(
    @Req() request: AuthenticatedRequest,
    @Param("incidentId") id: string,
    @Body() dto: InstitutionalResolutionDto,
  ) {
    return this.incidentsService.resolveInstitutional(
      id,
      request.user.sub,
      dto,
    );
  }
  @Post(":incidentId/operations")
  operationalEvent(
    @Req() request: AuthenticatedRequest,
    @Param("incidentId") id: string,
    @Body() dto: OperationalEventDto,
  ) {
    return this.incidentsService.operationalEvent(
      id,
      request.user.sub,
      dto.type,
      dto.note,
      dto.correlationId,
    );
  }
  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateIncidentDto) {
    return this.incidentsService.create(request.user.sub, dto);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.incidentsService.listForUser(request.user.sub);
  }

  /**
   * The subject reports that the emergency is over. Owner only - the service
   * enforces it, and a non-owner receives the same 404 as a stranger.
   */
  @Patch(":incidentId/resolve")
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param("incidentId") incidentId: string,
    @Body() dto: CloseIncidentDto,
  ) {
    return this.incidentsService.resolve(incidentId, request.user.sub, dto);
  }

  /** The subject reports that the activation was accidental. Owner only. */
  @Patch(":incidentId/cancel")
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("incidentId") incidentId: string,
    @Body() dto: CloseIncidentDto,
  ) {
    return this.incidentsService.cancel(incidentId, request.user.sub, dto);
  }
}
