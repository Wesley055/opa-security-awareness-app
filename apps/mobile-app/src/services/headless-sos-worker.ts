import {
  acknowledgeClaimedOpaProtectionTrigger,
  claimPendingOpaProtectionTrigger,
  releasePendingOpaProtectionTrigger,
  type OpaNativeProtectionTriggerClaim,
} from '../../modules/opa-protection';
import { activateFromHeadlessSosTrigger } from './headless-sos-activation';

const HEADLESS_SOS_OWNER = 'headless-sos';

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
      console.log(
        '[opa-protection-headless] native trigger claim release failed',
      );
    }
  } catch (error: unknown) {
    console.log(
      '[opa-protection-headless] native trigger claim release threw',
      error,
    );
  }
}

/**
 * Drains durable SOS_BUTTON records from the native FIFO.
 *
 * Native storage remains the source of truth. This worker never selects or
 * skips records. If VOICE owns the FIFO head, it releases that exact claim and
 * exits so the SOS path cannot overtake an older voice trigger.
 *
 * Backend activation/retrigger is terminal success. Tracking bootstrap is not
 * part of this transaction and must never cause the emergency to be activated
 * a second time.
 */
export async function runHeadlessSosWorker(): Promise<void> {
  while (true) {
    let claim: OpaNativeProtectionTriggerClaim | null;

    try {
      claim =
        await claimPendingOpaProtectionTrigger(
          HEADLESS_SOS_OWNER,
        );
    } catch (error: unknown) {
      console.log(
        '[opa-protection-headless] native trigger claim failed',
        error,
      );
      return;
    }

    if (claim === null) {
      return;
    }

    if (claim.type !== 'SOS_BUTTON') {
      await releaseClaim(claim);
      return;
    }

    let activation;

    try {
      activation =
        await activateFromHeadlessSosTrigger();
    } catch (error: unknown) {
      console.log(
        '[opa-protection-headless] SOS activation failed',
        error,
      );

      await releaseClaim(claim);
      return;
    }

    if (
      activation.status !== 'INCIDENT_ACTIVATED' &&
      activation.status !== 'INCIDENT_RETRIGGERED'
    ) {
      await releaseClaim(claim);
      return;
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
        '[opa-protection-headless] native trigger ACK threw',
        error,
      );
    }

    if (!acknowledged) {
      await releaseClaim(claim);
      return;
    }

    // Exact ACK removed this FIFO head. Continue so multiple locked-screen
    // SOS taps already persisted by native code are consumed in FIFO order.
  }
}