import { EmergencyDetectionService } from './emergency-detection.service';
import { ActivationMode, EmergencyTriggerType, TriggerMode } from './dto/trigger-request.dto';
import { ProfileProvider } from './providers/profile.provider';
import { VoiceProvider } from './providers/voice.provider';
import { TriggerProvider } from './providers/trigger.provider';
import { LanguageProvider } from './providers/language.provider';
import { ConfidenceProvider } from './providers/confidence.provider';
import { SilentProvider } from './providers/silent.provider';
const profile = new ProfileProvider();
const service = new EmergencyDetectionService(profile, new VoiceProvider(), new TriggerProvider(), new LanguageProvider(), new ConfidenceProvider(), new SilentProvider());
describe('Silent SOS detection', () => {
  it.each([ActivationMode.STANDARD, ActivationMode.SILENT])('keeps intentional SOS activation in %s', activationMode => {
    const result = service.evaluate({ triggerType: EmergencyTriggerType.SOS_BUTTON, mode: TriggerMode.CONFIRMATION, userConfirmed: true, activationMode });
    expect(result.outcome.shouldActivate).toBe(true);
    expect(result.outcome.isSilent).toBe(activationMode === ActivationMode.SILENT);
    expect(result.outcome.requiresConfirmation).toBe(false);
  });
  it.each([ActivationMode.STANDARD, ActivationMode.SILENT])('voice can activate immediately in %s', activationMode => {
    const result = service.evaluate({ triggerType: EmergencyTriggerType.VOICE, mode: TriggerMode.IMMEDIATE, detectedPhrase: 'HELP HELP', repetitionCount: 1, activationMode });
    expect(result.outcome.shouldActivate).toBe(true);
    expect(result.outcome.isSilent).toBe(activationMode === ActivationMode.SILENT);
  });
  it('never enables silent presentation from a server profile', () => {
    const configured = profile.getDefaultProfile();
    const spy = jest.spyOn(profile, 'getDefaultProfile').mockReturnValue({ ...configured, silentMode: true });
    expect(service.evaluate({ triggerType: EmergencyTriggerType.SOS_BUTTON, mode: TriggerMode.IMMEDIATE }).outcome.isSilent).toBe(false);
    spy.mockRestore();
  });
  it('does not elevate a missed safety check into an emergency', () => {
    expect(service.evaluate({ triggerType: EmergencyTriggerType.SAFETY_CHECK, mode: TriggerMode.IMMEDIATE, activationMode: ActivationMode.SILENT }).outcome.shouldActivate).toBe(false);
  });
  it('preserves cancellation in silent mode', () => {
    expect(service.evaluate({ triggerType: EmergencyTriggerType.SOS_BUTTON, mode: TriggerMode.CONFIRMATION, activationMode: ActivationMode.SILENT, cancellationReceived: true }).outcome.shouldActivate).toBe(false);
  });
});
