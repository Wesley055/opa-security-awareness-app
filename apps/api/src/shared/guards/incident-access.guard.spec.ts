import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IncidentAccessGuard } from './incident-access.guard';

describe('IncidentAccessGuard', () => {
  const prisma = {
    incident: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const guard = new IncidentAccessGuard(prisma as never);

  const context = (
    sub = 'operator-1',
    tokenRole = 'USER',
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            sub,
            email: 'operator@example.com',
            role: tokenRole,
          },
          params: { incidentId: 'incident-1' },
        }),
      }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.incident.findUnique.mockResolvedValue({
      userId: 'resident-1',
      facilityId: 'facility-a',
    });
  });

  it('allows the incident owner', async () => {
    await expect(
      guard.canActivate(context('resident-1')),
    ).resolves.toBe(true);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows an operator in the incident facility', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-a',
    });

    await expect(
      guard.canActivate(context('operator-1', 'USER')),
    ).resolves.toBe(true);
  });

  it('denies an operator from another facility', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-b',
    });

    await expect(
      guard.canActivate(context('operator-1', 'FACILITY_OPERATOR')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a plain USER who is not the owner', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'USER',
      facilityId: 'facility-a',
    });

    await expect(
      guard.canActivate(context('other-user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows ADMIN across tenant boundaries', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ADMIN',
      facilityId: null,
    });

    await expect(
      guard.canActivate(context('admin-1')),
    ).resolves.toBe(true);
  });

  it('uses database truth over a stale privileged JWT', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'USER',
      facilityId: 'facility-a',
    });

    await expect(
      guard.canActivate(context('operator-1', 'FACILITY_OPERATOR')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies every operator on an unrouted incident', async () => {
    prisma.incident.findUnique.mockResolvedValue({
      userId: 'resident-1',
      facilityId: null,
    });
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_OPERATOR',
      facilityId: null,
    });

    // Both sides null must NOT match. A resident who belongs to no estate
    // keeps their emergency private from every operator - and today that is
    // EVERY incident, because nothing assigns facilityId yet. If this ever
    // passes, one broken condition exposes every emergency in the system.
    await expect(
      guard.canActivate(context('operator-1', 'FACILITY_OPERATOR')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 when the incident does not exist', async () => {
    prisma.incident.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(context()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
