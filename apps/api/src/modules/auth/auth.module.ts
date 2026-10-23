import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { EnrollmentModule } from './enrollment.module';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationModule } from '../notifications/notification.module';
import { UsersModule } from '../users/users.module';
import { ActivationService } from './activation.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    PrismaModule,
    EnrollmentModule,
    UsersModule,
    NotificationModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController, AccountDeletionController],
  providers: [AccountDeletionService, AuthService, ActivationService, PasswordResetService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}