import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ActivationService } from './activation.service';
import { AuthService } from './auth.service';
import { ActivateOperatorDto } from './dto/activate-operator.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly activationService: ActivationService,
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

  /**
   * PUBLIC AND UNAUTHENTICATED, deliberately: the operator has no
   * credentials yet - that is what they are here to create. The
   * single-use activation token is the only thing authorising this call.
   *
   * The token arrives in the BODY. 13C-3 hands the administrator the path
   * /operator/activate/<token> for the web page; that page reads the
   * token from its own URL and posts it here. A capability travelling as
   * an API URL parameter ends up in access logs and proxy logs.
   */
  @HttpCode(HttpStatus.OK)
  @Post('activate')
  activate(@Body() dto: ActivateOperatorDto) {
    return this.activationService.activate(dto);
  }
}
