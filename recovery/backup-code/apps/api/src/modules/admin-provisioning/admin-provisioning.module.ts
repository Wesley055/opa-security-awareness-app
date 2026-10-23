import { OperationalOversightService } from "../onboarding/operational-oversight.service";
import { IncidentTimelineModule } from "../incident-timeline/incident-timeline.module";
import { CanonicalOrganizationService } from "../onboarding/canonical-organization.service";
import { OrganizationGovernanceController, CanonicalInstitutionalController } from "../onboarding/canonical-organization.controller";
import { InstitutionalService } from "../onboarding/institutional.service";
import {
  InstitutionalController,
  SupportAdministrationController,
} from "../onboarding/institutional.controller";
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
    IncidentTimelineModule,
    EnrollmentModule,
    ProtectedIdentityModule,
    PrismaModule,
    NotificationModule,
  ],
  controllers: [
    OrganizationGovernanceController,
    CanonicalInstitutionalController,
    InstitutionalController,
    SupportAdministrationController,
    AdminProvisioningController,
  ],
  providers: [
    OperationalOversightService,
    CanonicalOrganizationService,
    InstitutionalService,
    PlatformAdminService,
    AdminProvisioningService,
    AdminGuard,
    InvitationDeliveryWorker,
  ],
  exports: [AdminProvisioningService],
})
export class AdminProvisioningModule {}
