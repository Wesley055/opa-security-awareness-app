import 'server-only';

import { apiUrl, getAccessToken } from '@/lib/operator-session';

export type OperatorMember = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  accountStatus: string;
};

export type OperatorMembership = {
  facility: {
    id: string;
    name: string;
    isActive: boolean;
    isVerified: boolean;
  };
  operators: OperatorMember[];
  residents: OperatorMember[];
};

export type MembershipResult =
  | {
      state: 'READY';
      membership: OperatorMembership;
    }
  | { state: 'REJECTED' }
  | { state: 'FORBIDDEN'; message: string }
  | { state: 'UNAVAILABLE' };

/**
 * Reader-safe membership for the signed-in operator's facility.
 *
 * THE FACILITY ID IS NEVER PROVIDED BY THE BROWSER. The API route
 * GET /operator/facility/members uses OperatorFacilityGuard to derive the
 * authoritative facility from the authenticated operator row.
 *
 * This contract intentionally contains no administrative contact fields.
 * isActive, accountStatus and facility.isVerified are carried but 14A-11
 * does not render them.
 */
export async function fetchOperatorMembership(): Promise<MembershipResult> {
  const base = apiUrl();

  if (!base) {
    console.error('OPA_API_URL is not configured.');
    return { state: 'UNAVAILABLE' };
  }

  const accessToken = await getAccessToken();

  if (!accessToken) {
    return { state: 'REJECTED' };
  }

  const url = new URL('/operator/facility/members', base);

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error(
      'Operator membership could not reach the API:',
      error instanceof Error ? error.message : 'unknown error',
    );

    return { state: 'UNAVAILABLE' };
  }

  if (response.status === 401) {
    return { state: 'REJECTED' };
  }

  if (response.status === 403) {
    let message = 'This account cannot read this facility membership.';

    try {
      const body = (await response.json()) as { message?: string };

      if (typeof body.message === 'string' && body.message.trim()) {
        message = body.message;
      }
    } catch {
      // A 403 with an unreadable body remains a 403.
    }

    return {
      state: 'FORBIDDEN',
      message,
    };
  }

  if (!response.ok) {
    console.error(`Operator membership returned ${response.status}.`);
    return { state: 'UNAVAILABLE' };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    console.error('Operator membership returned unreadable JSON.');
    return { state: 'UNAVAILABLE' };
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('facility' in payload) ||
    !('operators' in payload) ||
    !('residents' in payload)
  ) {
    console.error('Operator membership returned an unexpected shape.');
    return { state: 'UNAVAILABLE' };
  }

  const candidate = payload as Partial<OperatorMembership>;

  if (
    !candidate.facility ||
    typeof candidate.facility.id !== 'string' ||
    typeof candidate.facility.name !== 'string' ||
    !Array.isArray(candidate.operators) ||
    !Array.isArray(candidate.residents)
  ) {
    console.error('Operator membership returned an unexpected shape.');
    return { state: 'UNAVAILABLE' };
  }

  return {
    state: 'READY',
    membership: candidate as OperatorMembership,
  };
}
