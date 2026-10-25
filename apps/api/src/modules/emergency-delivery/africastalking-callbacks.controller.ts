import { Body, Controller, Header, HttpCode, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { callbackSourceAllowed, callbackTokenMatches } from "./delivery-identity";
import { SmsInboundService, type InboundSms } from "./sms-inbound.service";
import { UssdService, type UssdRequest } from "./ussd.service";
import { PrismaService } from "../../prisma/prisma.service";
import { voiceResponse, type VoiceCallback } from "../emergency-assurance/voice-callback";

/**
 * Africa's Talking callbacks. Public (no JWT): protected by a long secret
 * path token, an optional source-IP allowlist and strict parsing. A wrong
 * token is a plain 404 so the endpoint reveals nothing.
 */
@Controller("integrations/africastalking")
export class AfricasTalkingCallbacksController {
  constructor(
    private readonly sms: SmsInboundService,
    private readonly ussd: UssdService,
    private readonly prisma: PrismaService,
  ) {}

  private guard(token: string, request: Request) {
    if (!callbackTokenMatches(token) || !callbackSourceAllowed(request.ip)) throw new NotFoundException();
  }

  @Post("sms/:token")
  @HttpCode(200)
  async inboundSms(@Param("token") token: string, @Req() request: Request, @Body() body: InboundSms) {
    this.guard(token, request);
    const outcome = await this.sms.handle(body ?? {});
    return { received: true, outcome };
  }

  @Post("ussd/:token")
  @HttpCode(200)
  @Header("Content-Type", "text/plain")
  async session(@Param("token") token: string, @Req() request: Request, @Body() body: UssdRequest): Promise<string> {
    this.guard(token, request);
    return this.ussd.handle(body ?? {});
  }

  /** Emergency assurance calls: the spoken alert, and "press 1" as confirmation. */
  @Post("voice/:token")
  @HttpCode(200)
  @Header("Content-Type", "application/xml")
  async voice(@Param("token") token: string, @Req() request: Request, @Body() body: VoiceCallback): Promise<string> {
    this.guard(token, request);
    return voiceResponse(this.prisma, body ?? {});
  }
}
