import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { EmergencyContactsModule } from './modules/emergency-contacts/emergency-contacts.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { validateEnv } from './shared/config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    IncidentsModule,
    EmergencyContactsModule,
    NotificationModule,
  ],
})
export class AppModule {}