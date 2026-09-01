import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationModule } from '../notifications/notification.module';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { AdminProvisioningController } from './admin-provisioning.controller';
import { AdminProvisioningService } from './admin-provisioning.service';
import { InvitationDeliveryWorker } from './invitation-delivery.worker';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [AdminProvisioningController],
  providers: [AdminProvisioningService, AdminGuard, InvitationDeliveryWorker],
  exports: [AdminProvisioningService],
})
export class AdminProvisioningModule {}
