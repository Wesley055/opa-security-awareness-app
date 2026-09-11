import { getSosActivationMode, incidentPresentationMode } from './silent-sos';
import { create } from 'zustand';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, backgroundApi } from './api';
import { useAuthStore } from '../store/authStore';
import { useActiveIncidentStore } from '../store/activeIncidentStore';
import { startTracking, stopTracking, trackerDebugState } from './journey-tracker';
import { BACKGROUND_SESSION_KEY } from './journey-background-task';

export interface SafeWalkStatus {
  id: string; status: 'STARTED' | 'ACTIVE' | 'ENDED'; destinationLabel: string;
  expectedArrivalAt: string; lastFixReceivedAt: string | null; safetyConfirmedAt: string | null;
  arrivalConfirmedAt: string | null; safeWalkEmergencyIncidentId: string | null;
  safeWalkEscalation: { state: string; checkDueAt: string; responseDueAt: string | null } | null;
  safetyChecksEnabled: boolean;
  safeWalkNotices: { id: string; kind: string; deliveryStatus: string; cancelledAt: string | null }[];
  guardianGrants: { id: string; revokedAt: string | null }[];
}
export interface SafeWalkPlan { destinationLabel: string; destinationLatitude: number; destinationLongitude: number; expectedArrivalAt: string; guardianCodes: string[]; }
export const useSafeWalk = create<{ journey: SafeWalkStatus | null; error: string | null; refreshedAt: number | null }>(() => ({ journey: null, error: null, refreshedAt: null }));
const currentUser = () => useAuthStore.getState().user?.id;

export async function refreshSafeWalk(isCurrent = () => true) {
  const owner = currentUser();
  if (!owner) return;
  try {
    const previous = useSafeWalk.getState().journey;
    const { data } = await backgroundApi.get<SafeWalkStatus | null>('/journey/safewalk/active');
    if (!isCurrent() || owner !== currentUser()) return;
    useSafeWalk.setState({ journey: data, error: null, refreshedAt: Date.now() });
    const storageKey = 'opa.safewalk.session.' + owner;
    if (data && data.status !== 'ENDED') {
      await SecureStore.setItemAsync(storageKey, data.id);
      if (isCurrent() && owner === currentUser()) await startTracking({ existingSessionId: data.id });
    } else {
      const remembered = previous?.id ?? await SecureStore.getItemAsync(storageKey);
      if (!remembered || !isCurrent() || owner !== currentUser()) return;
      // A cold process has no in-memory tracker id. Verify terminal owner state
      // before retiring the exact persisted SafeWalk background session.
      const terminal = (await backgroundApi.get<SafeWalkStatus>('/journey/sessions/' + remembered + '/safewalk')).data;
      if (terminal.status !== 'ENDED' || !isCurrent() || owner !== currentUser()) return;
      const backgroundId = await SecureStore.getItemAsync(BACKGROUND_SESSION_KEY);
      if (!isCurrent() || owner !== currentUser()) return;
      if (trackerDebugState().sessionId === remembered || backgroundId === remembered) await stopTracking(remembered);
      await SecureStore.deleteItemAsync(storageKey);
    }
  } catch {
    if (isCurrent() && owner === currentUser()) useSafeWalk.setState({ error: 'Unable to refresh SafeWalk. The last shown status may be out of date.' });
  }
}

/** The plan/key are persisted before create. A lost response replays the same intent. */
export async function createSafeWalk(plan: SafeWalkPlan) {
  const owner = currentUser();
  if (!owner) throw new Error('Sign in to start SafeWalk.');
  const storageKey = 'opa.safewalk.create.' + owner;
  const pending = await SecureStore.getItemAsync(storageKey);
  const intent: { key: string; plan: SafeWalkPlan } = pending ? JSON.parse(pending) : { key: (await api.post<{ key: string }>('/journey/safewalk/create-key')).data.key, plan };
  if (owner !== currentUser()) throw new Error('Your account changed. Please try again.');
  await SecureStore.setItemAsync(storageKey, JSON.stringify(intent));
  if (owner !== currentUser()) throw new Error('Your account changed. Please try again.');
  const { guardianCodes, ...destination } = intent.plan;
  const { data } = await api.post<{ sessionId: string; purpose: string; status: string }>('/journey/sessions', { ...destination, purpose: 'SAFEWALK', safeWalkCreateKey: intent.key });
  if (owner !== currentUser()) return;
  if (data.purpose !== 'SAFEWALK') throw new Error('An emergency is already active. Open SOS to manage it.');
  if (data.status === 'ENDED') { await SecureStore.deleteItemAsync(storageKey); throw new Error('The previous request already completed. Start a new journey.'); }
  await refreshSafeWalk();
  for (const code of guardianCodes) {
    if (owner !== currentUser()) return;
    await api.post('/safewalk/sessions/' + data.sessionId + '/guardians', { code });
  }
  await SecureStore.deleteItemAsync(storageKey);
  await refreshSafeWalk();
}

export async function confirmSafeWalk(action: 'confirm-arrival' | 'confirm-safety' | 'cancel-safewalk') {
  const session = useSafeWalk.getState().journey;
  if (!session) return;
  await api.post('/journey/sessions/' + session.id + '/' + action);
  if (action !== 'confirm-safety' && trackerDebugState().sessionId === session.id && !useActiveIncidentStore.getState().activeIncident) await stopTracking(session.id);
  await refreshSafeWalk();
}

/** Uses the existing emergency orchestrator; overdue work never calls this. */
export async function escalateSafeWalk() {
  const owner = currentUser();
  const journey = useSafeWalk.getState().journey;
  if (!owner || !journey) throw new Error('Refresh your journey before escalating.');
  const { data } = await api.post('/incident-orchestrator/activate', { triggerType: 'SOS_BUTTON', mode: 'CONFIRMATION', activationMode: getSosActivationMode(), activationSource: 'SAFEWALK_EXPLICIT', userConfirmed: true, safeWalkSessionId: journey.id });
  if (owner !== currentUser()) throw new Error('Your account changed. Sign in to the original account to verify emergency status.');
  if (!data?.incident?.id) throw new Error('Emergency activation was not confirmed. Retry or use SOS.');
  if (['OPEN', 'ACKNOWLEDGED'].includes(data.incident.status)) useActiveIncidentStore.getState().setActiveIncident({ id: data.incident.id, status: 'OPEN', activationMode: incidentPresentationMode(data.incident), notifications: data.notifications });
  await refreshSafeWalk();
  return data.incident.id as string;
}

export function startSafeWalkReconciliation() {
  let alive = true, running = false, revision = 0;
  let owner: string | undefined;
  const refresh = () => {
    const auth = useAuthStore.getState();
    if (!alive || running || auth.isLoading || !auth.isAuthenticated || AppState.currentState !== 'active') return;
    const token = revision; running = true;
    void refreshSafeWalk(() => alive && token === revision).finally(() => { running = false; });
  };
  const authChanged = () => {
    const next = currentUser();
    if (owner !== next) { owner = next; revision++; useSafeWalk.setState({ journey: null, error: null, refreshedAt: null }); }
    refresh();
  };
  const unsubscribe = useAuthStore.subscribe(authChanged);
  const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
  const timer = setInterval(refresh, 15_000);
  authChanged();
  return () => { alive = false; revision++; clearInterval(timer); unsubscribe(); subscription.remove(); };
}
