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

export type CreatedResident = { requestId: string; status: 'VERIFICATION_PENDING' };
export type BulkResidentResponse = { requests: Array<CreatedResident & { index: number }> };
export type EnrollmentStatus = { requestId: string; status: 'VERIFICATION_PENDING' | 'ACCEPTED' | 'EXPIRED'; createdAt: string; expiresAt: string };

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

type ApiRequestOptions = { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string };

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
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
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
  return isObject(value) && typeof value.requestId === 'string' && value.status === 'VERIFICATION_PENDING' && Object.keys(value).every(key => ['requestId','status','index'].includes(key));
}
function isBulkResponse(value: unknown): value is BulkResidentResponse {
  return isObject(value) && Array.isArray(value.requests) && value.requests.every(row => isCreatedResident(row) && typeof (row as Record<string, unknown>).index === 'number');
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
  idempotencyKey?: string,
): Promise<FacilityAdminResult<CreatedResident>> {
  const result = await facilityAdminRequest('/facility-admin/facility/residents', {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
  if (result.state === 'CONFLICT') return { state: 'UNAVAILABLE' };
  if (result.state !== 'READY') return result;
  return isCreatedResident(result.data) ? { state: 'READY', data: result.data } : unexpectedShape();
}

export async function createBulkFacilityAdminResidents(
  residents: CreateResidentInput[],
  idempotencyKey?: string,
): Promise<FacilityAdminResult<BulkResidentResponse>> {
  const result = await facilityAdminRequest('/facility-admin/facility/residents/bulk', {
    method: 'POST',
    body: { residents },
    idempotencyKey,
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

export async function fetchEnrollmentRequests(): Promise<FacilityAdminResult<{ requests: EnrollmentStatus[] }>> {
  const result = await facilityAdminRequest('/facility-admin/facility/residents/enrollments');
  if (result.state !== 'READY') return result;
  const data = result.data;
  if (!isObject(data) || !Array.isArray(data.requests) || !data.requests.every(row => isObject(row) && typeof row.requestId === 'string' && typeof row.createdAt === 'string' && typeof row.expiresAt === 'string' && ['VERIFICATION_PENDING','ACCEPTED','EXPIRED'].includes(String(row.status)))) return unexpectedShape();
  return { state: 'READY', data: { requests: data.requests.map(row => ({ requestId: row.requestId, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt })) } };
}
