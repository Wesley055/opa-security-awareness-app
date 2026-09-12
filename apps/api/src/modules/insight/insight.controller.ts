import { ApiExcludeController } from '@nestjs/swagger';
import { InsightGuard } from './insight.guard';
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InsightService } from './insight.service';
import { AggregateQueryDto, CreateActionDto, GenerateAirDto, ReportScopeDto, UpdateActionDto } from './insight.dto';

type AuthRequest = Request & { user: JwtPayload };
@Controller('internal/insight')
@ApiExcludeController()
@UseGuards(JwtAuthGuard, InsightGuard)
export class InsightController {
  constructor(private readonly service: InsightService) {}
  @Get('overview') @Header('Cache-Control', 'no-store')
  overview(@Req() req: AuthRequest, @Query() query: AggregateQueryDto) {
    return this.service.overview(req.user.sub, query);
  }
  @Post('incidents/:incidentId/reconcile')
  reconcile(@Req() req: AuthRequest, @Param('incidentId', ParseUUIDPipe) id: string, @Body() dto: ReportScopeDto) {
    return this.service.reconcile(req.user.sub, id, dto.facilityId);
  }
  @Post('incidents/:incidentId/air')
  generate(@Req() req: AuthRequest, @Param('incidentId', ParseUUIDPipe) id: string, @Body() dto: GenerateAirDto) {
    return this.service.generate(req.user.sub, id, dto.requestKey, dto.facilityId);
  }
  @Get('air/:reportId') @Header('Cache-Control', 'no-store')
  read(@Req() req: AuthRequest, @Param('reportId', ParseUUIDPipe) id: string, @Query() dto: ReportScopeDto) {
    return this.service.readAir(req.user.sub, id, dto.facilityId);
  }
  @Get('air/:reportId/export') @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="opa-air.json"')
  export(@Req() req: AuthRequest, @Param('reportId', ParseUUIDPipe) id: string, @Query() dto: ReportScopeDto) {
    return this.service.readAir(req.user.sub, id, dto.facilityId, true);
  }
  @Post('corrective-actions')
  createAction(@Req() req: AuthRequest, @Body() dto: CreateActionDto) {
    return this.service.createAction(req.user.sub, dto);
  }
  @Patch('corrective-actions/:actionId')
  updateAction(@Req() req: AuthRequest, @Param('actionId', ParseUUIDPipe) id: string, @Body() dto: UpdateActionDto) {
    return this.service.updateAction(req.user.sub, id, dto);
  }
  @Get('incidents/:incidentId/compliance-evidence') @Header('Cache-Control', 'no-store')
  compliance(@Req() req: AuthRequest, @Param('incidentId', ParseUUIDPipe) id: string, @Query() dto: ReportScopeDto) {
    return this.service.compliance(req.user.sub, id, dto.facilityId);
  }
}
