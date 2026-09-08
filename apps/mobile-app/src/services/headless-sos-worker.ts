import {
  acknowledgeClaimedOpaProtectionTrigger,
  claimPendingOpaProtectionTrigger,
  releasePendingOpaProtectionTrigger,
  type OpaNativeProtectionTriggerClaim,
} from '../../modules/opa-protection';
import { activateFromHeadlessSosTrigger } from './headless-sos-activation';

const HEADLESS_SOS_OWNER = 'headless-sos';
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
  console.log(`${HEADLESS_LOG} worker entered`);

  while (true) {
    let claim: OpaNativeProtectionTriggerClaim | null;

    try {
      claim =
        await claimPendingOpaProtectionTrigger(
          HEADLESS_SOS_OWNER,
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
      console.log(`${HEADLESS_LOG} claim result=NONE`);
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    if (claim.type !== 'SOS_BUTTON') {
      console.log(`${HEADLESS_LOG} claim result=VOICE`);
      await releaseClaim(claim);
      console.log(`${HEADLESS_LOG} worker complete`);
      return;
    }

    console.log(`${HEADLESS_LOG} claim result=SOS_BUTTON`);
    console.log(`${HEADLESS_LOG} activation starting`);

    let activation;

    try {
      activation =
        await activateFromHeadlessSosTrigger();
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

    // Exact ACK removed this FIFO head. Continue so multiple locked-screen
    // SOS taps already persisted by native code are consumed in FIFO order.
  }
}