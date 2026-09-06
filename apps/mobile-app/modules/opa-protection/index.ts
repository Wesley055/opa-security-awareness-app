import {
  requireNativeModule,
  type EventSubscription,
} from 'expo-modules-core';

export interface OpaVoiceProviderConfig {
  enabled: boolean;
  provider: 'picovoice_porcupine';
  accessKey: string;
  keywordAssetName: string;
  phrase: string;
  sensitivity: number;
}

export type OpaNativeProtectionTriggerType =
  | 'VOICE'
  | 'SOS_BUTTON';

/**
 * Durable provider-neutral emergency trigger emitted by OPA's native
 * protection layer.
 *
 * VOICE records carry phrase/provider metadata. SOS_BUTTON records do not
 * invent voice metadata. Provider-specific audio frames, keyword indexes,
 * and engine objects must never cross this boundary.
 */
export interface OpaNativeProtectionTrigger {
  id: string;
  type: OpaNativeProtectionTriggerType;
  timestamp: number;
  phrase?: string | null;
  provider?: string | null;
}

/**
 * Compatibility shape for callers that already know they are handling
 * a VOICE trigger.
 */
export interface OpaNativeVoiceTrigger
  extends OpaNativeProtectionTrigger {
  type: 'VOICE';
  phrase: string;
  provider: string;
}

interface OpaProtectionEvents {
  onVoiceTrigger(
    event: OpaNativeProtectionTrigger,
  ): void;
}

type OpaProtectionNativeModule = {
  configureVoiceProviderAsync(
    enabled: boolean,
    provider: string,
    accessKey: string,
    keywordAssetName: string,
    phrase: string,
    sensitivity: number,
  ): Promise<void>;

  clearVoiceProviderAsync(): Promise<void>;

  peekPendingVoiceTriggerAsync():
    Promise<OpaNativeProtectionTrigger | null>;

  ackPendingVoiceTriggerAsync(
    triggerId: string,
  ): Promise<boolean>;

  startAsync(): Promise<void>;
  stopAsync(): Promise<void>;

  addListener<EventName extends keyof OpaProtectionEvents>(
    eventName: EventName,
    listener: OpaProtectionEvents[EventName],
  ): EventSubscription;
};

const nativeModule =
  requireNativeModule<OpaProtectionNativeModule>(
    'OpaProtection',
  );

/**
 * Supplies an already-resolved voice-provider configuration to
 * OPA's native protection layer.
 *
 * The native layer does not read Expo environment variables and
 * does not contain a hard-coded provider credential.
 */
export async function configureOpaVoiceProvider(
  config: OpaVoiceProviderConfig,
): Promise<void> {
  await nativeModule.configureVoiceProviderAsync(
    config.enabled,
    config.provider,
    config.accessKey,
    config.keywordAssetName,
    config.phrase,
    config.sensitivity,
  );
}

export async function clearOpaVoiceProvider(): Promise<void> {
  await nativeModule.clearVoiceProviderAsync();
}

/**
 * Starts OPA's permanent Android protection foreground service.
 *
 * This boundary is provider-neutral. A voice provider must not own
 * the Android protection-service lifecycle.
 */
export async function startOpaProtectionService(): Promise<void> {
  await nativeModule.startAsync();
}

/**
 * Stops OPA's Android protection foreground service.
 *
 * React teardown must not call this merely because an Activity or
 * component disappears.
 */
export async function stopOpaProtectionService(): Promise<void> {
  await nativeModule.stopAsync();
}

/**
 * Returns the currently unacknowledged native trigger, if one exists.
 *
 * Reading a trigger never clears it.
 */
export async function peekPendingOpaVoiceTrigger():
Promise<OpaNativeProtectionTrigger | null> {
  return nativeModule.peekPendingVoiceTriggerAsync();
}

/**
 * Clears a durable native trigger only when the supplied ID still identifies
 * the pending record.
 */
export async function acknowledgePendingOpaVoiceTrigger(
  triggerId: string,
): Promise<boolean> {
  return nativeModule.ackPendingVoiceTriggerAsync(
    triggerId,
  );
}

/**
 * Observes provider-neutral native voice triggers while the OPA JavaScript
 * runtime is alive.
 *
 * This is not the durable process-death delivery mechanism.
 */
export function addOpaVoiceTriggerListener(
  listener: (event: OpaNativeProtectionTrigger) => void,
): EventSubscription {
  return nativeModule.addListener(
    'onVoiceTrigger',
    listener,
  );
}