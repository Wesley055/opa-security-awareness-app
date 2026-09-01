import 'server-only';
import { cache } from 'react';
import { apiUrl, getAccessToken } from '@/lib/operator-session';

/**
 * Who is signed in, their facility-scoped Viewer role, and their facility. 14A-5.
 *
 * `server-only` for the same reason lib/tracking.ts is: if this reached a
 * client component the API base URL would ship to the browser and the
 * operator's access token would be handled client-side, which is exactly
 * what the same-origin bridge exists to prevent.
 *
 * THE FACILITY ID IS SERVER-AUTHORITATIVE AND STAYS THAT WAY. It is
 * deliberately not cached in a cookie or localStorage for 14A-6 to read: a
 * browser-held facility id is a second authority that can drift from the
 * one the API enforces, and the Viewer would then be asserting membership
 * rather than reading it. FacilityOperatorGuard would reject a tampered id,
 * but "the guard catches it" is a worse design than "the browser never had
 * it". Facility-scoped Viewer pages get authoritative facility context here
 * in the same server request.
 *
 * WRAPPED IN React cache(). The shell reads the facility name for its
 * header and the queue page will read facility.id - two calls to /users/me
 * per render without it. cache() dedupes within ONE request pass and does
 * not persist between requests, so an operator whose account changed
 * between page loads is never served a stale identity.
 *
 * THE OUTCOME SHAPE FOLLOWS lib/tracking.ts, and the semantics follow the
 * refresh bridge: 401 is the one authoritative rejection and everything
 * else is an outage. An outage must never be mistaken for "you are not
 * allowed", because the two call for opposite responses - one ends the
 * session, the other waits.
 */

export type OperatorFacility = {
  id: string;
  name: string;
  /** Raw enum, e.g. SECURITY_PROVIDER. Formatting is the caller's business. */
  type: string;
  isActive: boolean;
  /**
   * CARRIED BUT NOT DISPLAYED by the 14A-5 header, deliberately. The header
   * answers "which facility am I monitoring", not "what is this facility's
   * commercial standing". OPA Demo Estate is isVerified FALSE in production,
   * and an "Unverified" badge above a live emergency queue would imply the
   * estate is unauthorised, which is not what the flag means. It is kept
   * here so a later policy decision has the truth available.
   */
  isVerified: boolean;
};

export type OperatorContext = {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  facility: OperatorFacility;
};

export type OperatorContextResult =
  | { state: 'READY'; context: OperatorContext }
  /**
   * Authenticated, but no facility to operate. An ADMIN has facilityId null
   * - admin authority is provisioning, not facility operation - and an
   * operator seat can exist before assignment. Neither is an error and
   * neither should end the session.
   */
  | { state: 'NO_FACILITY'; role: string | null }
  /** The access token was refused. The refresh route is the recovery path. */
  | { state: 'REJECTED' }
  /** The API could not be reached, or answered unusably. Says nothing about
   *  the credential, so nothing may be cleared on it. */
  | { state: 'UNAVAILABLE' };

type MeResponse = {
  id?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  facilityId?: string | null;
  facility?: {
    id?: string;
    name?: string;
    type?: string;
    isActive?: boolean;
    isVerified?: boolean;
  } | null;
};

export const getOperatorContext = cache(
  async (): Promise<OperatorContextResult> => {
    const base = apiUrl();

    if (!base) {
      console.error('OPA_API_URL is not configured.');
      return { state: 'UNAVAILABLE' };
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      // No token to present. Indistinguishable, from here, from one that
      // was refused - and the caller's response is the same either way.
      return { state: 'REJECTED' };
    }

    let response: Response;

    try {
      response = await fetch(`${base}/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      // Never log the token.
      console.error(
        'Operator context could not reach the API:',
        error instanceof Error ? error.message : 'unknown error',
      );
      return { state: 'UNAVAILABLE' };
    }

    if (response.status === 401) {
      return { state: 'REJECTED' };
    }

    if (!response.ok) {
      console.error(`Operator context returned ${response.status}.`);
      return { state: 'UNAVAILABLE' };
    }

    let me: MeResponse;

    try {
      me = (await response.json()) as MeResponse;
    } catch {
      console.error('Operator context returned unreadable JSON.');
      return { state: 'UNAVAILABLE' };
    }

    const facility = me.facility;

    // NO UNIVERSAL ROLE GATE HERE. Login admits only facility-scoped Viewer
    // roles, while each protected page applies the role appropriate to that
    // capability before calling its guarded API. The API remains the
    // authorization boundary and re-reads role and facility membership from
    // Postgres. FACILITY_OPERATOR uses incident operations; FACILITY_ADMIN
    // uses facility administration. Platform ADMIN belongs to OPA platform
    // administration and is not facility operational authority.
    if (!me.facilityId || !facility?.id || !facility.name) {
      return { state: 'NO_FACILITY', role: me.role ?? null };
    }

    return {
      state: 'READY',
      context: {
        userId: me.id ?? '',
        firstName: me.firstName ?? '',
        lastName: me.lastName ?? '',
        role: me.role ?? '',
        facility: {
          id: facility.id,
          name: facility.name,
          type: facility.type ?? '',
          isActive: facility.isActive ?? false,
          isVerified: facility.isVerified ?? false,
        },
      },
    };
  },
);