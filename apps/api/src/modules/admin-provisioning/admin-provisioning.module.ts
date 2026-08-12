import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { AdminProvisioningController } from './admin-provisioning.controller';
import { AdminProvisioningService } from './admin-provisioning.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminProvisioningController],
  providers: [AdminProvisioningService, AdminGuard],
})
export class AdminProvisioningModule {}
