import * as SecureStore from 'expo-secure-store';
import { api } from './api';

/** Offline SMS SOS configuration for this phone. Residents only; absent when the feature is off. */
export interface SmsFallbackConfig {
  keyId: string;
  key: string; // base64, from the server, never logged
  shortCode: string;
  keyword: string | null;
}

const STORE_KEY = 'opa.sms-fallback';

export async function getSmsFallbackConfig(): Promise<SmsFallbackConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SmsFallbackConfig;
    return parsed.keyId && parsed.key && parsed.shortCode ? parsed : null;
  } catch {
    return null;
  }
}

/** Fetched while online (after sign-in and on app start) so it is ready when there is no internet. */
export async function refreshSmsFallbackConfig(): Promise<void> {
  try {
    const { data } = await api.post<{ enabled: boolean } & Partial<SmsFallbackConfig>>('/emergency-delivery/sms-key');
    if (!data?.enabled || !data.keyId || !data.key || !data.shortCode) {
      await clearSmsFallbackConfig();
      return;
    }
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ keyId: data.keyId, key: data.key, shortCode: data.shortCode, keyword: data.keyword ?? null }));
  } catch {
    // Offline or not available: keep whatever is stored.
  }
}

export async function clearSmsFallbackConfig(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    // nothing to clear
  }
}
