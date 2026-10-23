import { Platform } from 'react-native';
// Load Android-only bindings only on Android; pure reconciliation works on every platform.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Android bridge must remain lazy on other platforms.
const native = (): typeof import('../../modules/opa-protection') => require('../../modules/opa-protection');

export type ActivationMode = 'STANDARD' | 'SILENT';
export const SILENT_SOS_NOTICE = 'Silent SOS reduces OPA sounds and visible feedback. Android microphone, location and service indicators remain visible; device settings and other apps may still make sound. This setting does not stop emergency notifications or location tracking.';

/** Only an explicit local settings action writes this preference. No server hydration. */
export function getSosActivationMode(): ActivationMode {
  return Platform.OS === 'android' ? native().getNativeSosActivationMode() : 'STANDARD';
}
export async function setSosActivationMode(mode: ActivationMode): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Silent SOS is supported on Android.');
  await native().setNativeSosActivationMode(mode);
  console.log(`[OPA-SOS] MODE_SAVED activationMode=${mode}`);
}
export function incidentPresentationMode(incident: { metadata?: unknown } | null | undefined, fallback: ActivationMode = 'STANDARD'): ActivationMode {
  const metadata = incident?.metadata;
  if (metadata && typeof metadata === 'object') {
    const mode = (metadata as { presentationMode?: unknown; activationMode?: unknown }).presentationMode
      ?? (metadata as { activationMode?: unknown }).activationMode;
    if (mode === 'SILENT' || mode === 'STANDARD') return mode;
  }
  return fallback;
}
