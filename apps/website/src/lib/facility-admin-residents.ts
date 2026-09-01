import 'server-only';

import { apiUrl, getAccessToken } from '@/lib/operator-session';

export type FacilityAdminResident = {
  id: string;
  email: string;
  phoneNumber: string | null;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  accountStatus: string;
};

export type FacilityAdminResidents = {
  facility: { id: string; name: string; isActive: boolean };
  residents: FacilityAdminResident[];
};

export type InvitationDelivery = {
  id: string;
  channel: string;
  status: string;
  attemptCount?: number;
  lastError?: string | null;
  queuedAt: string;
  nextAttemptAt: string | null;
  lastAttemptAt?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  createdAt?: string;
};

export type ResidentInvitation = {
  resident: {
    id: string;
    facilityId: string | null;
    isActive: boolean;
    accountStatus: string;
    activatedAt: string | null;
  };
  latest: InvitationDelivery | null;
  history: InvitationDelivery[];
  canResend: boolean;
  resendAvailableAt: string | null;
};

export type CreateResidentInput = {
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
};

export type CreatedResident = {
  user: {
    id: string;
    email: string;
    phoneNumber: string | null;
    firstName: string;
    lastName: string;
    role: string;
    facilityId: string;
    accountStatus: string;
    activationExpiresAt: string | null;
    invitedByUserId: string;
  };
  delivery: {
    id: string;
    channel: string;
    status: string;
    recipient: string;
    queuedAt: string;
    nextAttemptAt: string | null;
  };
};

export type BulkResidentResult =
  | { index: number; status: 'QUEUED'; user: CreatedResident['user']; delivery: CreatedResident['delivery'] }
  | { index: number; status: 'FAILED'; error: { statusCode: number; message: string } };

export type BulkResidentResponse = {
  total: number;
  queued: number;
  failed: number;
  results: BulkResidentResult[];
};

export type ResendInvitationResponse = {
  delivery: {
    id: string;
    channel: string;
    status: string;
    queuedAt: string;
    nextAttemptAt: string | null;
  };
};

export type FacilityAdminResult<T> =
  | { state: 'READY'; data: T }
  | { state: 'REJECTED' }
  | { state: 'FORBIDDEN'; message: string }
  | { state: 'CONFLICT'; message: string }
  | { state: 'INVALID'; message: string }
  | { state: 'NOT_FOUND'; message: string }
  | { state: 'UNAVAILABLE'; message?: string };

type ApiRequestOptions = { method?: 'GET' | 'POST'; body?: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as unknown;
    if (isObject(body)) {
      const message = body.message;
      if (typeof message === 'string' && message.trim()) return message;
      if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
        return message.join('; ');
      }
    }
  } catch {
    // Preserve the safe fallback when the API body is unreadable.
  }
  return fallback;
}

async function facilityAdminRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<FacilityAdminResult<unknown>> {
  const base = apiUrl();
  if (!base) {
    console.error('OPA_API_URL is not configured.');
    return { state: 'UNAVAILABLE' };
  }

  const accessToken = await getAccessToken();
  if (!accessToken) return { state: 'REJECTED' };

  let response: Response;
  try {
    response = await fetch(new URL(path, base), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error(
      'Facility Admin request could not reach the API:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return { state: 'UNAVAILABLE' };
  }

  if (response.status === 401) return { state: 'REJECTED' };
  if (response.status === 403) {
    return {
      state: 'FORBIDDEN',
      message: await responseMessage(response, 'This account cannot administer residents for this facility.'),
    };
  }
  if (response.status === 404) {
    return { state: 'NOT_FOUND', message: await responseMessage(response, 'Resident not found.') };
  }
  if (response.status === 409) {
    return {
      state: 'CONFLICT',
      message: await responseMessage(response, 'The requested resident operation conflicts with current account state.'),
    };
  }
  if (response.status === 400 || response.status === 422) {
    return {
      state: 'INVALID',
      message: await responseMessage(response, 'Please check the resident information and try again.'),
    };
  }
  if (!response.ok) {
    console.error(`Facility Admin request returned ${response.status}.`);
    return { state: 'UNAVAILABLE' };
  }

  try {
    return { state: 'READY', data: (await response.json()) as unknown };
  } catch {
    console.error('Facility Admin request returned unreadable JSON.');
    return { state: 'UNAVAILABLE' };
  }
}

function isResident(value: unknown): value is FacilityAdminResident {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    (typeof value.phoneNumber === 'string' || value.phoneNumber === null) &&
    typeof value.firstName === 'string' &&
    typeof value.lastName === 'string' &&
    typeof value.role === 'string' &&
    typeof value.isActive === 'boolean' &&
    typeof value.accountStatus === 'string'
  );
}

function isResidentsPayload(value: unknown): value is FacilityAdminResidents {
  return (
    isObject(value) &&
    isObject(value.facility) &&
    typeof value.facility.id === 'string' &&
    typeof value.facility.name === 'string' &&
    typeof value.facility.isActive === 'boolean' &&
    Array.isArray(value.residents) &&
    value.residents.every(isResident)
  );
}

function isDelivery(value: unknown): value is InvitationDelivery {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.channel === 'string' &&
    typeof value.status === 'string' &&
    typeof value.queuedAt === 'string' &&
    (typeof value.nextAttemptAt === 'string' || value.nextAttemptAt === null)
  );
}

function isInvitationPayload(value: unknown): value is ResidentInvitation {
  return (
    isObject(value) &&
    isObject(value.resident) &&
    typeof value.resident.id === 'string' &&
    (typeof value.resident.facilityId === 'string' || value.resident.facilityId === null) &&
    typeof value.resident.isActive === 'boolean' &&
    typeof value.resident.accountStatus === 'string' &&
    (typeof value.resident.activatedAt === 'string' || value.resident.activatedAt === null) &&
    (value.latest === null || isDelivery(value.latest)) &&
    Array.isArray(value.history) &&
    value.history.every(isDelivery) &&
    typeof value.canResend === 'boolean' &&
    (typeof value.resendAvailableAt === 'string' || value.resendAvailableAt === null)
  );
}

function isCreatedResident(value: unknown): value is CreatedResident {
  return (
    isObject(value) &&
    isObject(value.user) &&
    isObject(value.delivery) &&
    typeof value.user.id === 'string' &&
    typeof value.user.email === 'string' &&
    (typeof value.user.phoneNumber === 'string' || value.user.phoneNumber === null) &&
    typeof value.user.firstName === 'string' &&
    typeof value.user.lastName === 'string' &&
    typeof value.user.role === 'string' &&
    typeof value.user.facilityId === 'string' &&
    typeof value.user.accountStatus === 'string' &&
    (typeof value.user.activationExpiresAt === 'string' || value.user.activationExpiresAt === null) &&
    typeof value.user.invitedByUserId === 'string' &&
    typeof value.delivery.id === 'string' &&
    typeof value.delivery.channel === 'string' &&
    typeof value.delivery.status === 'string' &&
    typeof value.delivery.recipient === 'string' &&
    typeof value.delivery.queuedAt === 'string' &&
    (typeof value.delivery.nextAttemptAt === 'string' || value.delivery.nextAttemptAt === null)
  );
}

function isBulkResponse(value: unknown): value is BulkResidentResponse {
  if (
    !isObject(value) ||
    typeof value.total !== 'number' ||
    typeof value.queued !== 'number' ||
    typeof value.failed !== 'number' ||
    !Array.isArray(value.results)
  ) return false;

  return value.results.every((result) => {
    if (!isObject(result) || typeof result.index !== 'number') return false;
    if (result.status === 'QUEUED') {
      return isCreatedResident({ user: result.user, delivery: result.delivery });
    }
    return (
      result.status === 'FAILED' &&
      isObject(result.error) &&
      typeof result.error.statusCode === 'number' &&
      typeof result.error.message === 'string'
    );
  });
}

function isResendResponse(value: unknown): value is ResendInvitationResponse {
  return (
    isObject(value) &&
    isObject(value.delivery) &&
    typeof value.delivery.id === 'string' &&
    typeof value.delivery.channel === 'string' &&
    typeof value.delivery.status === 'string' &&
    typeof value.delivery.queuedAt === 'string' &&
    (typeof value.delivery.nextAttemptAt === 'string' || value.delivery.nextAttemptAt === null)
  );
}

function unexpectedShape<T>(): FacilityAdminResult<T> {
  console.error('Facility Admin API returned an unexpected shape.');
  return { state: 'UNAVAILABLE' };
}

export async function fetchFacilityAdminResidents(): Promise<FacilityAdminResult<FacilityAdminResidents>> {
  const result = await facilityAdminRequest('/facility-admin/facility/residents');
  if (result.state !== 'READY') return result;
  return isResidentsPayload(result.data) ? { state: 'READY', data: result.data } : unexpectedShape();
}

export async function fetchResidentInvitation(userId: string): Promise<FacilityAdminResult<ResidentInvitation>> {
  const result = await facilityAdminRequest(
    `/facility-admin/facility/residents/${encodeURIComponent(userId)}/invitation`,
  );
  if (result.state !== 'READY') return result;
  return isInvitationPayload(result.data) ? { state: 'READY', data: result.data } : unexpectedShape();
}

export async function createFacilityAdminResident(
  input: CreateResidentInput,
): Promise<FacilityAdminResult<CreatedResident>> {
  const result = await facilityAdminRequest('/facility-admin/facility/residents', {
    method: 'POST',
    body: input,
  });
  if (result.state !== 'READY') return result;
  return isCreatedResident(result.data) ? { state: 'READY', data: result.data } : unexpectedShape();
}

export async function createBulkFacilityAdminResidents(
  residents: CreateResidentInput[],
): Promise<FacilityAdminResult<BulkResidentResponse>> {
  const result = await facilityAdminRequest('/facility-admin/facility/residents/bulk', {
    method: 'POST',
    body: { residents },
  });
  if (result.state !== 'READY') return result;
  return isBulkResponse(result.data) ? { state: 'READY', data: result.data } : unexpectedShape();
}

export async function resendResidentInvitation(
  userId: string,
): Promise<FacilityAdminResult<ResendInvitationResponse>> {
  const result = await facilityAdminRequest(
    `/facility-admin/facility/residents/${encodeURIComponent(userId)}/invitation/resend`,
    { method: 'POST' },
  );
  if (result.state !== 'READY') return result;
  return isResendResponse(result.data) ? { state: 'READY', data: result.data } : unexpectedShape();
}
