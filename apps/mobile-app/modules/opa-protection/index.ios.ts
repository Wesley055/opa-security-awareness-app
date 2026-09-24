import type { EventSubscription } from 'expo-modules-core';

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

export interface OpaNativeProtectionTrigger {
  id: string;
  type: OpaNativeProtectionTriggerType;
  timestamp: number;
  activationMode?: 'SILENT' | 'STANDARD';
  phrase?: string | null;
  provider?: string | null;
}

export interface OpaNativeProtectionTriggerClaim
  extends OpaNativeProtectionTrigger {
  claimToken: string;
}

export interface OpaNativeVoiceTrigger
  extends OpaNativeProtectionTrigger {
  type: 'VOICE';
  phrase: string;
  provider: string;
}

/*
 * OpaProtection is an Android-only native module.
 *
 * iOS must never resolve requireNativeModule('OpaProtection').
 * These functions preserve the shared JavaScript contract while the
 * corresponding native protection service is unavailable on iOS.
 */

export const emergencyTrackingNative = () => null;

export async function configureOpaVoiceProvider(
  _config: OpaVoiceProviderConfig,
): Promise<void> {}

export async function clearOpaVoiceProvider(): Promise<void> {}

export async function startOpaProtectionService(): Promise<void> {}

export async function stopOpaProtectionService(): Promise<void> {}

export async function claimPendingOpaProtectionTrigger(
  _ownerId: string,
): Promise<OpaNativeProtectionTriggerClaim | null> {
  return null;
}

export async function releasePendingOpaProtectionTrigger(
  _triggerId: string,
  _claimToken: string,
): Promise<boolean> {
  return false;
}

export async function acknowledgeClaimedOpaProtectionTrigger(
  _triggerId: string,
  _claimToken: string,
): Promise<boolean> {
  return false;
}

export async function peekPendingOpaVoiceTrigger():
Promise<OpaNativeProtectionTrigger | null> {
  return null;
}

export async function acknowledgePendingOpaVoiceTrigger(
  _triggerId: string,
): Promise<boolean> {
  return false;
}

export function addOpaVoiceTriggerListener(
  _listener: (event: OpaNativeProtectionTrigger) => void,
): EventSubscription {
  return {
    remove() {},
  };
}

export function isOpaForegroundEligible(): boolean {
  return false;
}

export function getNativeSosActivationMode(): 'SILENT' | 'STANDARD' {
  return 'STANDARD';
}

export async function setNativeSosActivationMode(
  _mode: 'SILENT' | 'STANDARD',
): Promise<void> {}
