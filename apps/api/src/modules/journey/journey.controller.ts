import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
// VALUE import, deliberately. @Body() relies on emitDecoratorMetadata
// writing this class into design:paramtypes. An import type erases it to
// Object and ValidationPipe then validates NOTHING, silently.
import { IngestFixesDto } from './dto/ingest-fixes.dto';
import { JourneyIngestionService } from './journey-ingestion.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller('journey')
export class JourneyController {
  constructor(
    private readonly journeyIngestionService: JourneyIngestionService,
  ) {}

  @Post('fixes')
  ingest(
    @Req() request: AuthenticatedRequest,
    @Body() dto: IngestFixesDto,
  ) {
    return this.journeyIngestionService.ingest(request.user.sub, dto);
  }
}
