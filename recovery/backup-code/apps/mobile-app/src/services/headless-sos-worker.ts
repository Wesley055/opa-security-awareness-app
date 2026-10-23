import { authSessionEpoch } from './auth-session-epoch';
import { rememberEmergencyTracking, reconcileEmergencyTracking, bootstrapEmergencyTracking } from './emergency-tracking';
import { useActiveIncidentStore } from '../store/activeIncidentStore';
import {
  acknowledgeClaimedOpaProtectionTrigger,
  claimPendingOpaProtectionTrigger,
  releasePendingOpaProtectionTrigger,
  type OpaNativeProtectionTriggerClaim,
} from '../../modules/opa-protection';
import { activateFromHeadlessSosTrigger } from './headless-sos-activation';
import { processOpaProtectionTrigger } from './opa-protection-trigger-processor';
import { processVoiceTrigger } from './voice-protection-service';
import { activateFromSosTrigger } from './sos-activation-coordinator';
import { isForegroundExecutionAllowed } from './foreground-execution';

const HEADLESS_PROTECTION_OWNER = 'headless-protection';
const HEADLESS_LOG = '[OPA-HEADLESS]';

function errorCategory(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }

  return typeof error;
}

async function releaseClaim(
  claim: OpaNativeProtectionTriggerClaim,
): Promise<void> {
  try {
    const released =
      await releasePendingOpaProtectionTrigger(
        claim.id,
        claim.claimToken,
      );

    if (!released) {
      console.log(`${HEADLESS_LOG} claim release failed`);
    }
  } catch (error: unknown) {
    console.log(
      `${HEADLESS_LOG} claim release exception category=${errorCategory(error)}`,
    );
  }
}

/**
 * Drains durable emergency trigger records from the native FIFO.
 *
 * Native storage remains the source of truth. This worker never selects or
 * skips records. Both consumers select execution policy from actual lifecycle
 * eligibility. Restricted SOS retains its proven headless activation.
 * RETRY releases and stops.
 *
 * Backend activation/retrigger is terminal success. Tracking bootstrap is not
 * part of this transaction and must never cause the emergency to be activated
 * a second time.
 */
export async function runHeadlessProtectionWorker(
  ownerId: 'headless-protection' | 'foreground-react' = HEADLESS_PROTECTION_OWNER,
): Promise<void> {
  console.log(`${HEADLESS_LOG} worker entered`);

  while (true) {
    let claim: OpaNativeProtectionTriggerClaim | null;

    try {
      claim =
        await claimPendingOpaProtectionTrigger(
          ownerId,
        );
    } catch (error: unknown) {
      console.log(
        `${HEADLESS_LOG} claim exception category=${errorCategory(error)}`,
      );
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    console.log(`${HEADLESS_LOG} native FIFO claim attempted`);

    if (claim === null) {
      await reconcileEmergencyTracking().catch(() => console.log('[OPA-TRACKING] RECONCILIATION_DEFERRED'));
      console.log(`${HEADLESS_LOG} claim result=NONE`);
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    // Ownership does not confer foreground eligibility. Re-evaluate each FIFO head.
    const interactive = isForegroundExecutionAllowed();
    console.log(`${HEADLESS_LOG} owner=${ownerId} type=${claim.type} policy=${interactive ? 'FOREGROUND_INTERACTIVE' : 'BACKGROUND_RESTRICTED'}`);

    if (claim.type === 'VOICE') {
      console.log(`${HEADLESS_LOG} claim result=VOICE`);
      try {
        const disposition = await processOpaProtectionTrigger(claim, {
          processVoiceTrigger: (event) => processVoiceTrigger(event, interactive ? 'foreground' : 'headless'),
          // This branch only receives VOICE. Never synthesize an SOS activation.
          processSosTrigger: async () => 'RETRY',
          acknowledge: () => acknowledgeClaimedOpaProtectionTrigger(
            claim.id,
            claim.claimToken,
          ),
        });
        console.log(`${HEADLESS_LOG} VOICE processing result=${disposition}`);
        if (disposition === 'ACK') {
          console.log(`${HEADLESS_LOG} ACK result=SUCCESS`);
          continue;
        }
      } catch (error: unknown) {
        console.log(`${HEADLESS_LOG} VOICE exception category=${errorCategory(error)}`);
      }
      await releaseClaim(claim);
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    console.log(`${HEADLESS_LOG} claim result=SOS_BUTTON`);
    console.log(`${HEADLESS_LOG} activation starting`);
    console.log(`[OPA-SOS] REQUEST mode=${claim.activationMode ?? 'STANDARD'} source=LOCK_SCREEN`);

    const activationEpoch = authSessionEpoch();
    let activation;

    try {
      activation =
        await (interactive ? activateFromSosTrigger(claim.activationMode) : activateFromHeadlessSosTrigger(claim.activationMode));
    } catch (error: unknown) {
      console.log(
        `${HEADLESS_LOG} activation exception category=${errorCategory(error)}`,
      );

      await releaseClaim(claim);
      console.log(`${HEADLESS_LOG} activation result=RETRY`);
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    if (activation.status === 'INCIDENT_ACTIVATED') {
      console.log(`${HEADLESS_LOG} activation result=ACTIVATED`);
    } else if (activation.status === 'INCIDENT_RETRIGGERED') {
      console.log(`${HEADLESS_LOG} activation result=RETRIGGERED`);
    } else if (activation.status === 'LOCATION_UNAVAILABLE') {
      console.log(`${HEADLESS_LOG} activation result=RETRY`);
    } else {
      console.log(
        `${HEADLESS_LOG} activation result=TERMINAL_NO_ACTIVATION`,
      );
    }

    if (
      activation.status !== 'INCIDENT_ACTIVATED' &&
      activation.status !== 'INCIDENT_RETRIGGERED'
    ) {
      await releaseClaim(claim);
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    if (activation.incidentId) {
      useActiveIncidentStore.getState().setActiveIncident({
        id: activation.incidentId, status: 'OPEN', notifications: activation.notifications,
        ...(activation.activationMode ? { activationMode: activation.activationMode } : {}),
      });
    }

    if (!interactive && activation.incidentId) {
      try {
        await rememberEmergencyTracking(activation.incidentId, activationEpoch);
      } catch {
        await releaseClaim(claim);
        return;
      }
    }

    let acknowledged = false;

    try {
      acknowledged =
        await acknowledgeClaimedOpaProtectionTrigger(
          claim.id,
          claim.claimToken,
        );
    } catch (error: unknown) {
      console.log(
        `${HEADLESS_LOG} ACK exception category=${errorCategory(error)}`,
      );
    }

    if (!acknowledged) {
      console.log(`${HEADLESS_LOG} ACK result=FAILED`);
      await releaseClaim(claim);
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    console.log(`${HEADLESS_LOG} ACK result=SUCCESS`);
    if (!interactive && activationEpoch === authSessionEpoch() && activation.incidentId && 'journeySessionId' in activation && typeof activation.journeySessionId === 'string') {
      try {
        await bootstrapEmergencyTracking(activation.incidentId, activation.journeySessionId);
      } catch {
        console.log('[OPA-TRACKING] BOOTSTRAP_DEFERRED');
        return;
      }
    }

    // Exact ACK removed this FIFO head. Continue so multiple locked-screen
    // emergency triggers already persisted by native code are consumed in FIFO order.
  }
}