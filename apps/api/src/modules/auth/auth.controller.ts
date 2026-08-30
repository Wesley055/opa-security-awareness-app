import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
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
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.passwordResetService.requestReset(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.passwordResetService.confirmReset(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('activate')
  activate(@Body() dto: ActivateProvisionedUserDto) {
    return this.activationService.activate(dto);
  }
}