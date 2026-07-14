import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { EmergencyContactsModule } from './modules/emergency-contacts/emergency-contacts.module';
import { EmergencyDetectionModule } from './modules/emergency-detection/emergency-detection.module';
import { EmergencyIntelligenceModule } from './modules/emergency-intelligence/emergency-intelligence.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { IncidentOrchestratorModule } from './modules/incident-orchestrator/incident-orchestrator.module';
import { IncidentTimelineModule } from './modules/incident-timeline/incident-timeline.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { RefreshTokenModule } from './modules/refresh-token/refresh-token.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { validateEnv } from './shared/config/env.validation';
import { CorrelationIdMiddleware } from './shared/middleware/correlation-id.middleware';
import { RequestLoggingMiddleware } from './shared/middleware/request-logging.middleware';
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
    EmergencyIntelligenceModule,
    EmergencyDetectionModule,
    IncidentOrchestratorModule,
    RefreshTokenModule,
    FacilitiesModule,
    IncidentTimelineModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        CorrelationIdMiddleware,
        RequestLoggingMiddleware,
      )
      .forRoutes('*');
  }
}