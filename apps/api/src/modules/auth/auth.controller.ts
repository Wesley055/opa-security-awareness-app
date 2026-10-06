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
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { EnrollmentService } from "./enrollment.service";
import {
  VerifyEnrollmentDto,
  AcceptEnrollmentDto,
  ContinueEnrollmentDto,
} from "./dto/verify-enrollment.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { ActivationService } from "./activation.service";
import { AuthService } from "./auth.service";
import { ActivateProvisionedUserDto } from "./dto/activate-provisioned-user.dto";
import { ConfirmPasswordResetDto } from "./dto/confirm-password-reset.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { RequestPasswordResetDto } from "./dto/request-password-reset.dto";
import { PasswordResetService } from "./password-reset.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly activationService: ActivationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly enrollment: EnrollmentService,
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.ACCEPTED)
  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Headers("idempotency-key") key?: string,
  ) {
    const pending = await this.enrollment.request(dto, key ?? randomUUID());
    return {
      ...pending,
      credentialStep: "SET_PASSWORD_DURING_VERIFICATION",
      message:
        "Enrollment is pending. Complete both proofs and choose and confirm your password during activation. No login credential has been established.",
    };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  @Post("enrollment/verify")
  async verifyEnrollment(@Body() dto: VerifyEnrollmentDto) {
    const result = await this.enrollment.verify(dto);
    if (result.status === "ACCEPTED")
      return {
        status: result.status,
        role: result.user.role,
        ...(await this.authService.issueTokens(result.user)),
      };
    return result;
  }

  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  @Post("enrollment/accept")
  acceptEnrollment(
    @Req() request: { user: { sub: string } },
    @Body() dto: AcceptEnrollmentDto,
  ) {
    return this.enrollment.accept(request.user.sub, dto);
  }

  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  @Post("enrollment/continue")
  continueEnrollment(
    @Req() request: { user: { sub: string } },
    @Body() dto: ContinueEnrollmentDto,
  ) {
    return this.enrollment.continueVerified(request.user.sub, dto.requestId);
  }

  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  @Post("password-reset/request")
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.passwordResetService.requestReset(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  @Post("password-reset/confirm")
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.passwordResetService.confirmReset(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  @Post("activate")
  activate(@Body() dto: ActivateProvisionedUserDto) {
    return this.activationService.activate(dto);
  }
}
