import {
  Controller,
  Delete,
  Header,
  HttpCode,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AccountDeletionService } from "./account-deletion.service";

@Controller("auth")
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Delete("account")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  deleteAccount(@Req() request: { user: { sub: string } }) {
    // There is intentionally no caller-selectable account identifier or body.
    return this.deletion.deleteAccount(request.user.sub);
  }
}
