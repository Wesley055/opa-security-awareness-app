import { Controller, Header, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SmsKeysService } from "./sms-keys.service";

@Controller("emergency-delivery")
@UseGuards(JwtAuthGuard)
export class SmsKeysController {
  constructor(private readonly keys: SmsKeysService) {}

  @Post("sms-key")
  @Header("Cache-Control", "no-store")
  issue(@Req() request: { user: { sub: string } }) {
    return this.keys.issue(request.user.sub);
  }
}
