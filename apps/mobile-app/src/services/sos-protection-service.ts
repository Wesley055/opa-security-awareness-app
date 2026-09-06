import { useActiveIncidentStore } from '../store/activeIncidentStore';
import { activateFromSosTrigger } from './sos-activation-coordinator';

export type SosTriggerProcessingDisposition =
  | 'ACK'
  | 'RETRY';

/**
 * Canonical processor for an explicit SOS_BUTTON trigger.
 *
 * ACK means the trigger reached a terminal application decision and a
 * durable native copy may be acknowledged.
 *
 * RETRY means activation did not reach a terminal decision and the durable
 * native copy must remain pending.
 */
export async function processSosTrigger():
Promise<SosTriggerProcessingDisposition> {
  try {
    const result = await activateFromSosTrigger();

    if (
      result.status === 'INCIDENT_ACTIVATED' &&
      result.incidentId
    ) {
      useActiveIncidentStore.getState().setActiveIncident({
        id: result.incidentId,
        status: 'OPEN',
        notifications: result.notifications,
      });
    }

    console.log(
      `[sos-protection] activation result: ${result.status}`,
    );

    if (result.status === 'LOCATION_UNAVAILABLE') {
      return 'RETRY';
    }

    return 'ACK';
  } catch (error: unknown) {
    console.log(
      '[sos-protection] incident activation failed',
      error,
    );

    return 'RETRY';
  }
}