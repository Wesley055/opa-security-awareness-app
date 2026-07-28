import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
// VALUE import, deliberately. @Body() relies on emitDecoratorMetadata
// writing this class into design:paramtypes. An import type erases it to
// Object and ValidationPipe then validates NOTHING, silently.
import { IngestFixesDto } from './dto/ingest-fixes.dto';
// VALUE import, same reason as above.
import { StartSessionDto } from './dto/start-session.dto';
import { JourneyIngestionService } from './journey-ingestion.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller('journey')
export class JourneyController {
  constructor(
    private readonly journeyIngestionService: JourneyIngestionService,
  ) {}

  /**
   * Idempotent. Returns the active session, creating one only if the
   * caller has none. Safe to call on every app launch.
   */
  @Post('sessions')
  startSession(
    @Req() request: AuthenticatedRequest,
    @Body() dto: StartSessionDto,
  ) {
    return this.journeyIngestionService.startSession(request.user.sub, dto);
  }

  @Post('fixes')
  ingest(
    @Req() request: AuthenticatedRequest,
    @Body() dto: IngestFixesDto,
  ) {
    return this.journeyIngestionService.ingest(request.user.sub, dto);
  }
}
