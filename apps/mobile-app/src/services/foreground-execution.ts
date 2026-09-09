import { AppState, Platform } from 'react-native';

/** Fail closed before permission UI or a new tracking bootstrap. */
export function isForegroundExecutionAllowed(): boolean {
  if (AppState.currentState !== 'active') return false;
  if (Platform.OS !== 'android') return true;
  try {
    return require('../../modules/opa-protection').isOpaForegroundEligible() === true;
  } catch {
    return false;
  }
}
