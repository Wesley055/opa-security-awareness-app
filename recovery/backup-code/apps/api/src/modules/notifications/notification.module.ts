import { ProtectedIdentityModule } from "../protected-identity/protected-identity.module";
import { DeliveryReceiptWorker } from "./delivery-receipt.worker";
import {
  DeliveryReceiptController,
  ResendReceiptVerifier,
} from "./delivery-receipt.controller";
import {
  DeliveryReadController,
  DeliveryReadService,
} from "./delivery-read.controller";
import { IncidentAccessGuard } from "../../shared/guards/incident-access.guard";
import { DeliveryLedgerService } from "./delivery-ledger.service";
import { Module } from "@nestjs/common";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { EmailProvider } from "./providers/email.provider";
import { PushProvider } from "./providers/push.provider";
import { SmsProvider } from "./providers/sms.provider";
import { VoiceProvider } from "./providers/voice.provider";
import { WhatsAppProvider } from "./providers/whatsapp.provider";
import { NotificationDispatchWorker } from "./notification-dispatch.worker";

@Module({
  imports: [ProtectedIdentityModule],
  controllers: [
    NotificationController,
    DeliveryReceiptController,
    DeliveryReadController,
  ],
  providers: [
    NotificationService,
    DeliveryLedgerService,
    ResendReceiptVerifier,
    DeliveryReceiptWorker,
    DeliveryReadService,
    IncidentAccessGuard,
    SmsProvider,
    WhatsAppProvider,
    PushProvider,
    EmailProvider,
    VoiceProvider,
    NotificationDispatchWorker,
  ],
  // SmsProvider is exported as TRANSPORT, not as notification policy. The
  // invitation worker in AdminProvisioningModule sends account invitations
  // over SMS; that is not incident notification, and the provider stays
  // here because this is where transport infrastructure belongs.
  exports: [
    DeliveryLedgerService,
    NotificationService,
    EmailProvider,
    SmsProvider,
  ],
})
export class NotificationModule {}
