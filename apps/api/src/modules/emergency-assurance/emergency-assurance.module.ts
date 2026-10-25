import { Module } from "@nestjs/common";
import { NotificationModule } from "../notifications/notification.module";
import { EmergencyAssuranceWorker } from "./assurance.worker";

@Module({
  imports: [NotificationModule],
  providers: [EmergencyAssuranceWorker],
})
export class EmergencyAssuranceModule {}
