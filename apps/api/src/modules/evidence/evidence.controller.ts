import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IncidentAccessGuard } from '../../shared/guards/incident-access.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { UploadEvidenceDto } from './dto/upload-evidence.dto';
import { EvidenceService } from './evidence.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

const MAX_EVIDENCE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB — see note in evidence.service.ts on the in-memory-buffer limitation this caps against

@UseGuards(JwtAuthGuard, IncidentAccessGuard)
@Controller('incidents/:incidentId/evidence')
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_EVIDENCE_SIZE_BYTES } }),
  )
  async upload(
    @Req() request: AuthenticatedRequest,
    @Param('incidentId') incidentId: string,
    @Body() dto: UploadEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided.');
    }

    return this.evidenceService.uploadEvidence({
      incidentId,
      type: dto.type,
      buffer: file.buffer,
      mimeType: file.mimetype,
      capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : undefined,
      actorUserId: request.user.sub,
    });
  }

  @Get()
  list(@Param('incidentId') incidentId: string) {
    return this.evidenceService.listForIncident(incidentId);
  }

  @Get(':evidenceId/download-url')
  getDownloadUrl(@Param('evidenceId') evidenceId: string) {
    return this.evidenceService.getDownloadUrl(evidenceId);
  }
}