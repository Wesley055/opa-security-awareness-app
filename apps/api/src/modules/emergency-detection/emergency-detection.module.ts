import { Module } from '@nestjs/common';
import { EmergencyDetectionController } from './emergency-detection.controller';
import { EmergencyDetectionService } from './emergency-detection.service';
import { ConfidenceProvider } from './providers/confidence.provider';
import { LanguageProvider } from './providers/language.provider';
import { ProfileProvider } from './providers/profile.provider';
import { SilentProvider } from './providers/silent.provider';
import { TriggerProvider } from './providers/trigger.provider';
import { VoiceProvider } from './providers/voice.provider';

@Module({
  controllers: [EmergencyDetectionController],
  providers: [
    EmergencyDetectionService,
    ProfileProvider,
    VoiceProvider,
    TriggerProvider,
    LanguageProvider,
    ConfidenceProvider,
    SilentProvider,
  ],
  exports: [EmergencyDetectionService],
})
export class EmergencyDetectionModule {}