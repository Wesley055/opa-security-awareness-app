import { Platform } from 'react-native';
import type { emergencyTrackingNative } from '../../modules/opa-protection';

/** Load the Android bridge only on Android; UI eligibility is deliberately irrelevant here. */
export function nativeEmergencyTracking(): ReturnType<typeof emergencyTrackingNative> | null {
  if (Platform.OS !== 'android') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/opa-protection').emergencyTrackingNative();
}
