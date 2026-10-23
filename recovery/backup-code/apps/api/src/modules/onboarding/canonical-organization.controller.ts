import { OperationalOversightService } from "./operational-oversight.service";
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import {
  FacilityOperationalState,
  SupportCapability,
  SupportCaseStatus,
} from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdminGuard } from "../../shared/guards/admin.guard";
import type { JwtPayload } from "../auth/jwt.strategy";
import { CanonicalOrganizationService } from "./canonical-organization.service";
class ContextDto {
  @IsString() @Length(1, 500) reason!: string;
  @IsUUID() caseReference!: string;
  @IsUUID() correlationId!: string;
}
class OrganizationDto extends ContextDto {
  @IsString() @Length(1, 160) name!: string;
}
class AssociationDto extends ContextDto {
  @IsUUID() organizationId!: string;
}
class AssignmentDto extends ContextDto {
  @IsOptional() @IsUUID() supportId?: string;
}
class ProfileDto extends ContextDto {
  @IsUUID() facilityId!: string;
}
class ElevationDto extends ProfileDto {
  @IsUUID() supportId!: string;
  @IsEnum(SupportCapability) capability!: SupportCapability;
  @IsISO8601() startsAt!: string;
  @IsISO8601() expiresAt!: string;
}
class CaseDto extends ContextDto {
  @IsString() @Length(1, 80) category!: string;
  @IsString() @Length(1, 500) summary!: string;
  @IsIn(["LOW", "NORMAL", "HIGH", "CRITICAL"]) priority!: string;
}
class CaseStateDto extends ContextDto {
  @IsEnum(SupportCaseStatus) status!: SupportCaseStatus;
}
class EvidenceDto extends ContextDto {
  @IsString() @Length(1, 80) gate!: string;
  @IsBoolean() passed!: boolean;
  @IsString() @Length(1, 1000) evidence!: string;
  @IsOptional() @IsUUID() facilityAdminUserId?: string;
}
class LifecycleDto extends ContextDto {
  @IsEnum(FacilityOperationalState) state!: FacilityOperationalState;
}
class ResponsePolicyDto extends ContextDto {
 @IsInt() @Min(1) @Max(604800) acknowledgementSeconds!:number;
 @IsInt() @Min(1) @Max(604800) dispatchSeconds!:number;
 @IsInt() @Min(1) @Max(604800) progressSeconds!:number;
 @IsInt() @Min(1) @Max(604800) unattendedSeconds!:number;
 @IsInt() @Min(1) @Max(604800) closureSeconds!:number;
}
type Request = { user: JwtPayload };
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/organization")
export class OrganizationGovernanceController {
  constructor(private readonly service: CanonicalOrganizationService) {}
  @Get() organizations(@Req() req: Request) {
    return this.service.organizations(req.user.sub);
  }

  @Get("overview")
  overview(@Req() req: Request) {
    return this.service.overview(req.user.sub);
  }
  @Post() create(@Req() req: Request, @Body() dto: OrganizationDto) {
    return this.service.createOrganization(req.user.sub, dto.name, dto);
  }
  @Post("facilities/:id/organization") associate(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssociationDto,
  ) {
    return this.service.associate(req.user.sub, id, dto.organizationId, dto);
  }
  @Post("facilities/:id/assignment") assign(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignmentDto,
  ) {
    return this.service.assign(req.user.sub, id, dto.supportId ?? null, dto);
  }
  @Post("employees/:id/profile") profile(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ProfileDto,
  ) {
    return this.service.profile(req.user.sub, id, dto.facilityId, dto);
  }
  @Post("elevations") elevate(@Req() req: Request, @Body() dto: ElevationDto) {
    return this.service.elevate(
      req.user.sub,
      dto.supportId,
      dto.facilityId,
      dto.capability,
      new Date(dto.startsAt),
      new Date(dto.expiresAt),
      dto,
    );
  }
  @Post("elevations/:id/revoke") revoke(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ContextDto,
  ) {
    return this.service.revokeElevation(req.user.sub, id, dto);
  }
}
@UseGuards(JwtAuthGuard)
@Controller("institutional")
export class CanonicalInstitutionalController {
  constructor(private readonly service: CanonicalOrganizationService,private readonly oversight:OperationalOversightService) {}
  @Get("facilities/:id/oversight") oversightRead(@Req() req:Request,@Param("id",ParseUUIDPipe) id:string){return this.oversight.oversight(req.user.sub,id);}
  @Post("facilities/:id/response-policy") policy(@Req() req:Request,@Param("id",ParseUUIDPipe) id:string,@Body() dto:ResponsePolicyDto){return this.service.responsePolicy(req.user.sub,id,{acknowledgementSeconds:dto.acknowledgementSeconds,dispatchSeconds:dto.dispatchSeconds,progressSeconds:dto.progressSeconds,unattendedSeconds:dto.unattendedSeconds,closureSeconds:dto.closureSeconds},dto);}
  @Get("operations/:id") receipt(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.receipt(req.user.sub, id);
  }
  @Get("facilities/:id/cases") cases(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.cases(req.user.sub, id);
  }
  @Post("facilities/:id/cases") createCase(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CaseDto,
  ) {
    return this.service.createCase(
      req.user.sub,
      id,
      { category: dto.category, summary: dto.summary, priority: dto.priority },
      dto,
    );
  }
  @Post("facilities/:id/cases/:caseId/state") caseState(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Body() dto: CaseStateDto,
  ) {
    return this.service.caseState(req.user.sub, id, caseId, dto.status, dto);
  }
  @Get("facilities/:id/commissioning") commissioning(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.commissioning(req.user.sub, id);
  }
  @Post("facilities/:id/commissioning/evidence") evidence(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EvidenceDto,
  ) {
    return this.service.recordEvidence(
      req.user.sub,
      id,
      {
        gate: dto.gate,
        passed: dto.passed,
        evidence: dto.evidence,
        facilityAdminUserId: dto.facilityAdminUserId,
      },
      dto,
    );
  }
  @Post("facilities/:id/lifecycle") lifecycle(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: LifecycleDto,
  ) {
    return this.service.lifecycle(req.user.sub, id, dto.state, dto);
  }
}
