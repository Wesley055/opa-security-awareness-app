import { authSessionEpoch } from './auth-session-epoch';
import { backgroundApi } from './api';
import { nativeEmergencyTracking } from './emergency-tracking-native';
import { startTracking, stopTracking, trackerDebugState } from './journey-tracker';

type Incident = { id: string; status: string; journeySessionId?: string | null };
let reconciliation: Promise<void> | null = null;

/** Persist before trigger ACK. Tracking failure must not replay incident activation. */
export async function rememberEmergencyTracking(incidentId: string, expectedEpoch = authSessionEpoch()): Promise<void> {
  if (expectedEpoch !== authSessionEpoch()) return;
  await nativeEmergencyTracking()?.rememberEmergencyTrackingIncidentAsync(incidentId);
  console.log('[OPA-TRACKING] OBLIGATION_DURABLE');
}

/** Activation response already proves ownership and identifies the canonical session. */
export async function bootstrapEmergencyTracking(incidentId: string, journeySessionId: string): Promise<void> {
  const native = nativeEmergencyTracking();
  if (native?.getEmergencyTrackingIncident() !== incidentId) return;
  await startTracking({ existingSessionId: journeySessionId, emergencyIncidentId: incidentId });
  const state = trackerDebugState();
  if (!state.running || state.sessionId !== journeySessionId) throw new Error('Emergency capture is not running');
  console.log('[OPA-TRACKING] STARTED_WITHOUT_RESUME');
}

export function reconcileEmergencyTracking(): Promise<void> {
  if (reconciliation) return reconciliation;
  reconciliation = reconcile().finally(() => { reconciliation = null; });
  return reconciliation;
}

async function reconcile(): Promise<void> {
  const epoch = authSessionEpoch();
  const native = nativeEmergencyTracking();
  const expected = native?.getEmergencyTrackingIncident();
  if (!native || !expected) return;
  // Owner-scoped authoritative read. Never create a MANUAL/SafeWalk session to recover an emergency.
  const { data } = await backgroundApi.get<Incident[]>('/incidents');
  if (epoch !== authSessionEpoch() || native.getEmergencyTrackingIncident() !== expected) return;
  const incident = data.find((item) => item.id === expected);
  if (!incident || !['OPEN', 'ACKNOWLEDGED'].includes(incident.status)) {
    await stopTracking(undefined, expected);
    console.log('[OPA-TRACKING] RESOLVED_OR_NO_LONGER_OWNED');
    return;
  }
  if (!incident.journeySessionId) throw new Error('Active incident has no authoritative journey session');
  await startTracking({ existingSessionId: incident.journeySessionId, emergencyIncidentId: expected });
  const state = trackerDebugState();
  if (!state.running || state.sessionId !== incident.journeySessionId) throw new Error('Emergency capture is not running');
  console.log('[OPA-TRACKING] RECONCILED_WITHOUT_RESUME');
}
