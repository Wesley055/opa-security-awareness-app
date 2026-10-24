import { Module } from "@nestjs/common";
import { IncidentOrchestratorModule } from "../incident-orchestrator/incident-orchestrator.module";
import { IncidentTimelineModule } from "../incident-timeline/incident-timeline.module";
import { AfricasTalkingCallbacksController } from "./africastalking-callbacks.controller";
import { SavedPlacesController } from "./saved-places.controller";
import { SmsInboundService } from "./sms-inbound.service";
import { SmsKeysController } from "./sms-keys.controller";
import { SmsKeysService } from "./sms-keys.service";
import { UssdService } from "./ussd.service";

/** Emergency delivery (release 48): offline SMS SOS, USSD SOS, saved places. Off unless switched on. */
@Module({
  imports: [IncidentOrchestratorModule, IncidentTimelineModule],
  controllers: [SmsKeysController, AfricasTalkingCallbacksController, SavedPlacesController],
  providers: [SmsKeysService, SmsInboundService, UssdService],
})
export class EmergencyDeliveryModule {}
