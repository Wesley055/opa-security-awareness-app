import { ForbiddenException } from '@nestjs/common';
import { OperatorFacilityGuard } from './operator-facility.guard';

/**
 * NOT A SUITE OF ONLY REJECTIONS. Five tests refuse and two ALLOW, because a
 * guard that refused everybody would pass a refusal-only suite completely -
 * auth.service.spec.ts had exactly that shape once, four tests and no
 * successful login among them.
 *
 * The two allow-tests also assert the SIDE EFFECT: this guard's second job
 * is attaching operatorFacilityId, and a guard that returned true without
 * attaching it would leave the controller passing undefined to the query.
 */
describe('OperatorFacilityGuard', () => {
  type Row = {
    role: string;
    facilityId: string | null;
    isActive: boolean;
  } | null;

  function makeGuard(row: Row) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(row) },
    };
    return new OperatorFacilityGuard(prisma as never);
  }

  function makeContext(request: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
  }

  function makeRequest() {
    return { user: { sub: 'user-1', email: 'op@example.com' } } as Record<
      string,
      unknown
    >;
  }

  it('refuses when the account no longer exists', async () => {
    await expect(
      makeGuard(null).canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a suspended operator even with a facility', async () => {
    // Suspension outranks role and assignment both.
    const guard = makeGuard({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-1',
      isActive: false,
    });

    await expect(
      guard.canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a resident', async () => {
    const guard = makeGuard({
      role: 'USER',
      facilityId: 'facility-1',
      isActive: true,
    });

    await expect(
      guard.canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an operator with no facility assigned', async () => {
    const guard = makeGuard({
      role: 'FACILITY_OPERATOR',
      facilityId: null,
      isActive: true,
    });

    await expect(
      guard.canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an administrator with no facility assigned', async () => {
    // DELIBERATE, and the one place this guard differs from
    // FacilityOperatorGuard. That guard gives admins a cross-tenant
    // override because a facility is named in the URL to override TO. This
    // route means "my assigned facility", and an unassigned account has no
    // such queue. Admins use /facilities/:facilityId/incidents instead.
    const guard = makeGuard({
      role: 'ADMIN',
      facilityId: null,
      isActive: true,
    });

    await expect(
      guard.canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an assigned operator and attaches the resolved facility', async () => {
    const guard = makeGuard({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-1',
      isActive: true,
    });
    const request = makeRequest();

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.operatorFacilityId).toBe('facility-1');
  });

  it('allows an administrator who does have a facility', async () => {
    const guard = makeGuard({
      role: 'ADMIN',
      facilityId: 'facility-2',
      isActive: true,
    });
    const request = makeRequest();

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.operatorFacilityId).toBe('facility-2');
  });
});