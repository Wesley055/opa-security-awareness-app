import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshTokenService } from './refresh-token.service';

@Controller('auth')
export class RefreshTokenController {
  constructor(
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.refreshTokenService.rotate(dto.refreshToken);
  }
}