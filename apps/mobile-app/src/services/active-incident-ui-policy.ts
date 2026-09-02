import type { ActiveIncident } from '../store/activeIncidentStore';

export function homeEmergencyAction(
  activeIncident: ActiveIncident | null,
): 'ACTIVATE_SOS' | 'OPEN_ACTIVE_INCIDENT' {
  return activeIncident ? 'OPEN_ACTIVE_INCIDENT' : 'ACTIVATE_SOS';
}

export function sosInitialMode(
  activeIncident: ActiveIncident | null,
): 'countdown' | 'activated' {
  return activeIncident ? 'activated' : 'countdown';
}