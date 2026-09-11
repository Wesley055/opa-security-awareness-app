import type { VoiceTriggerEvent } from './voice-trigger-provider';

export type OpaProtectionTriggerType =
  | 'VOICE'
  | 'SOS_BUTTON';

export interface OpaProtectionTrigger {
  id: string;
  type: OpaProtectionTriggerType;
  timestamp: number;
  activationMode?: 'SILENT' | 'STANDARD';
  phrase?: string | null;
  provider?: string | null;
}

export type OpaProtectionProcessingDisposition =
  | 'ACK'
  | 'RETRY';

interface OpaProtectionTriggerDependencies {
  processVoiceTrigger(
    event: VoiceTriggerEvent,
  ): Promise<OpaProtectionProcessingDisposition>;

  processSosTrigger(
    event: OpaProtectionTrigger,
  ): Promise<OpaProtectionProcessingDisposition>;

  acknowledge(
    triggerId: string,
  ): Promise<boolean>;
}

export async function processOpaProtectionTrigger(
  event: OpaProtectionTrigger,
  dependencies: OpaProtectionTriggerDependencies,
): Promise<OpaProtectionProcessingDisposition> {
  const triggerId = event.id.trim();

  if (
    triggerId.length === 0 ||
    !Number.isFinite(event.timestamp) ||
    event.timestamp <= 0
  ) {
    return 'RETRY';
  }

  let disposition: OpaProtectionProcessingDisposition;

  if (event.type === 'SOS_BUTTON') {
    disposition =
      await dependencies.processSosTrigger(event);
  } else {
    if (
      event.provider !== 'picovoice_porcupine' ||
      typeof event.phrase !== 'string' ||
      event.phrase.trim().length === 0
    ) {
      const acknowledged =
        await dependencies.acknowledge(triggerId);

      return acknowledged ? 'ACK' : 'RETRY';
    }

    disposition =
      await dependencies.processVoiceTrigger({
        ...(event.activationMode ? { activationMode: event.activationMode } : {}),
        phrase: event.phrase,
        confidence: null,
        timestamp: event.timestamp,
        provider: 'picovoice_porcupine',
      });
  }

  if (disposition === 'RETRY') {
    return 'RETRY';
  }

  const acknowledged =
    await dependencies.acknowledge(triggerId);

  return acknowledged ? 'ACK' : 'RETRY';
}