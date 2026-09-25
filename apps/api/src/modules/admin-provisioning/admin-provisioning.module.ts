import { OnboardingService } from "../onboarding/onboarding.service";
import {
  OnboardingController,
  OnboardingGrantsController,
} from "../onboarding/onboarding.controller";
import { PlatformAdminService } from "./platform-admin.service";
import { EnrollmentModule } from "../auth/enrollment.module";
import { ProtectedIdentityModule } from "../protected-identity/protected-identity.module";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { NotificationModule } from "../notifications/notification.module";
import { AdminGuard } from "../../shared/guards/admin.guard";
import { AdminProvisioningController } from "./admin-provisioning.controller";
import { AdminProvisioningService } from "./admin-provisioning.service";
import { InvitationDeliveryWorker } from "./invitation-delivery.worker";

@Module({
  imports: [
    EnrollmentModule,
    ProtectedIdentityModule,
    PrismaModule,
    NotificationModule,
  ],
  controllers: [
    AdminProvisioningController,
    OnboardingController,
    OnboardingGrantsController,
  ],
  providers: [
    PlatformAdminService,
    OnboardingService,
    AdminProvisioningService,
    AdminGuard,
    InvitationDeliveryWorker,
  ],
  exports: [AdminProvisioningService],
})
export class AdminProvisioningModule {}
