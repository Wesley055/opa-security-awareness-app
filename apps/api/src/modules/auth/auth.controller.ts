import {
  Body,
  Headers,
  Header,
  Req,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { EnrollmentService } from './enrollment.service';
import { VerifyEnrollmentDto, AcceptEnrollmentDto } from './dto/verify-enrollment.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ActivationService } from './activation.service';
import { AuthService } from './auth.service';
import { ActivateProvisionedUserDto } from './dto/activate-provisioned-user.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly activationService: ActivationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly enrollment: EnrollmentService,
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('register')
  register(@Body() dto: RegisterDto, @Headers('idempotency-key') key?: string) {
    return this.enrollment.request(dto, key ?? randomUUID());
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('enrollment/verify')
  async verifyEnrollment(@Body() dto: VerifyEnrollmentDto) {
    const result = await this.enrollment.verify(dto);
    if (result.status === 'ACCEPTED') return { status: result.status, ...await this.authService.issueTokens(result.user) };
    return result;
  }

  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('enrollment/accept')
  acceptEnrollment(@Req() request: { user: { sub: string } }, @Body() dto: AcceptEnrollmentDto) {
    return this.enrollment.accept(request.user.sub, dto);
  }

  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.passwordResetService.requestReset(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.passwordResetService.confirmReset(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('activate')
  activate(@Body() dto: ActivateProvisionedUserDto) {
    return this.activationService.activate(dto);
  }
}