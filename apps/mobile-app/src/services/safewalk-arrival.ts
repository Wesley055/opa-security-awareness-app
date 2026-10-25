import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { backgroundApi } from './api';

/**
 * SafeWalk arrival (Issue #54, owner rules 24 Oct):
 * - arrival is DETECTED automatically: inside the destination area, with good
 *   accuracy, for about a minute;
 * - it never marks the person safe: it asks, with one tap ("I'm safe");
 * - nobody else is told about the arrival;
 * - it never delays the missed-arrival check, which stays on the server clock;
 * - poor GPS asks instead of guessing.
 */
export const ARRIVAL_DWELL_MS = 60_000;
export const ARRIVAL_MAX_ACCURACY_M = 50;
export const SAFEWALK_TARGET_KEY = 'opa.safewalk.target';
const ARRIVAL_STATE_KEY = 'opa.safewalk.arrival';

export const SAFEWALK_CATEGORY = 'opa-safewalk-check';
export const SAFEWALK_SAFE_ACTION = 'OPA_SAFEWALK_SAFE';
export const SAFEWALK_SOS_ACTION = 'OPA_SAFEWALK_SOS';
export const SAFEWALK_KIND = 'opa-safewalk-check';

export interface ArrivalTarget {
  sessionId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  label: string;
  expectedArrivalAt: string;
}
export interface ArrivalState { sessionId: string; insideSince: number | null; detectedAt: number | null }
export interface Fix { latitude: number; longitude: number; accuracy: number | null; timestamp: number }

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180, r = 6_371_000;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Pure: feeds fixes (in time order) into the dwell rule. */
export function evaluateArrival(state: ArrivalState, target: ArrivalTarget, fixes: readonly Fix[]): { state: ArrivalState; detected: boolean } {
  let next = { ...state };
  if (next.sessionId !== target.sessionId) next = { sessionId: target.sessionId, insideSince: null, detectedAt: null };
  if (next.detectedAt) return { state: next, detected: false };
  for (const fix of [...fixes].sort((a, b) => a.timestamp - b.timestamp)) {
    // A vague fix neither starts nor breaks the dwell: we wait for a good one.
    if (fix.accuracy === null || fix.accuracy > ARRIVAL_MAX_ACCURACY_M) continue;
    const inside = distanceMeters(fix, target) <= target.radiusMeters;
    if (!inside) { next.insideSince = null; continue; }
    if (next.insideSince === null) next.insideSince = fix.timestamp;
    if (fix.timestamp - next.insideSince >= ARRIVAL_DWELL_MS) {
      next.detectedAt = fix.timestamp;
      return { state: next, detected: true };
    }
  }
  return { state: next, detected: false };
}

export async function configureSafeWalkNotifications(): Promise<void> {
  // Both actions open the app. On a locked iPhone that also asks to unlock,
  // which is deliberate: a snatched phone cannot mark its owner safe.
  await Notifications.setNotificationCategoryAsync(SAFEWALK_CATEGORY, [
    { identifier: SAFEWALK_SAFE_ACTION, buttonTitle: "I'm safe", options: { opensAppToForeground: true } },
    { identifier: SAFEWALK_SOS_ACTION, buttonTitle: 'SOS', options: { opensAppToForeground: true } },
  ]);
}

const promptContent = (title: string, body: string, sessionId: string): Notifications.NotificationContentInput => ({
  title,
  body,
  data: { opaKind: SAFEWALK_KIND, sessionId },
  categoryIdentifier: SAFEWALK_CATEGORY,
  priority: Notifications.AndroidNotificationPriority.HIGH,
});

/** Saved at start so the background task can detect arrival with no network. */
export async function rememberArrivalTarget(target: ArrivalTarget): Promise<void> {
  await SecureStore.setItemAsync(SAFEWALK_TARGET_KEY, JSON.stringify(target));
  await SecureStore.deleteItemAsync(ARRIVAL_STATE_KEY).catch(() => undefined);
  try {
    await configureSafeWalkNotifications();
    const at = new Date(target.expectedArrivalAt);
    if (at.getTime() > Date.now() + 5_000) {
      await Notifications.scheduleNotificationAsync({
        identifier: 'opa-safewalk-due-' + target.sessionId,
        content: promptContent('SafeWalk', `Have you arrived safely at ${target.label}?`, target.sessionId),
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
      });
    }
  } catch {
    // Notifications are a convenience; the server-side check still runs.
  }
}

export async function forgetArrivalTarget(sessionId?: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(SAFEWALK_TARGET_KEY).catch(() => null);
  const target = raw ? (JSON.parse(raw) as ArrivalTarget) : null;
  if (sessionId && target && target.sessionId !== sessionId) return;
  await SecureStore.deleteItemAsync(SAFEWALK_TARGET_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(ARRIVAL_STATE_KEY).catch(() => undefined);
  const id = sessionId ?? target?.sessionId;
  if (id) {
    await Notifications.cancelScheduledNotificationAsync('opa-safewalk-due-' + id).catch(() => undefined);
    await Notifications.dismissNotificationAsync('opa-safewalk-arrived-' + id).catch(() => undefined);
  }
}

/**
 * Called by the background location task after the fixes are durable. Never
 * throws: arrival detection must not affect location capture.
 */
export async function checkSafeWalkArrival(sessionId: string, fixes: readonly Fix[]): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(SAFEWALK_TARGET_KEY);
    if (!raw) return false;
    const target = JSON.parse(raw) as ArrivalTarget;
    if (target.sessionId !== sessionId) return false;
    const saved = await SecureStore.getItemAsync(ARRIVAL_STATE_KEY);
    const state: ArrivalState = saved ? JSON.parse(saved) : { sessionId, insideSince: null, detectedAt: null };
    const result = evaluateArrival(state, target, fixes);
    await SecureStore.setItemAsync(ARRIVAL_STATE_KEY, JSON.stringify(result.state));
    if (!result.detected) return false;
    await configureSafeWalkNotifications();
    await Notifications.scheduleNotificationAsync({
      identifier: 'opa-safewalk-arrived-' + sessionId,
      content: promptContent("You've arrived", `You're at ${target.label}. Tap "I'm safe" to finish your SafeWalk.`, sessionId),
      trigger: null,
    });
    const last = [...fixes].sort((a, b) => b.timestamp - a.timestamp)[0]!;
    await backgroundApi
      .post('/safewalk/sessions/' + sessionId + '/arrival-detected', { latitude: last.latitude, longitude: last.longitude, accuracy: last.accuracy ?? undefined })
      .catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function isSafeWalkResponse(response: Notifications.NotificationResponse): { action: 'SAFE' | 'SOS' | 'OPEN'; sessionId: string } | null {
  const data = response.notification.request.content.data as { opaKind?: string; sessionId?: string } | undefined;
  if (data?.opaKind !== SAFEWALK_KIND || !data.sessionId) return null;
  const action = response.actionIdentifier === SAFEWALK_SAFE_ACTION ? 'SAFE' : response.actionIdentifier === SAFEWALK_SOS_ACTION ? 'SOS' : 'OPEN';
  return { action, sessionId: data.sessionId };
}
