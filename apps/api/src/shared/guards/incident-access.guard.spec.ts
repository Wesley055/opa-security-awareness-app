import { NotFoundException } from '@nestjs/common';
import { IncidentAccessGuard } from './incident-access.guard';
import { incidentScope } from '../security/incident-scope';

describe('IncidentAccessGuard', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    incident: { findFirst: jest.fn() },
  };
  const guard = new IncidentAccessGuard(prisma as never);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        user: { sub: 'operator-a', role: 'ADMIN' },
        params: { incidentId: 'incident-b' },
      }),
    }),
  } as never;
  beforeEach(() => jest.resetAllMocks());
  it('queries only current database scope, ignoring a forged role claim', async () => {
    const actor = {
      role: 'FACILITY_OPERATOR',
      facilityId: 'a',
      isActive: true,
      accountStatus: 'ACTIVE',
    };
    prisma.user.findUnique.mockResolvedValue(actor);
    prisma.incident.findFirst.mockResolvedValue({ id: 'incident-a' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.incident.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [{ id: 'incident-b' }, incidentScope('operator-a', actor)],
      },
      select: { id: true },
    });
  });
  it.each(['foreign', 'missing'])(
    'returns the same 404 for a %s incident',
    async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: 'USER',
        facilityId: null,
        isActive: true,
        accountStatus: 'ACTIVE',
      });
      prisma.incident.findFirst.mockResolvedValue(null);
      await expect(guard.canActivate(context)).rejects.toEqual(
        new NotFoundException('Incident not found.'),
      );
    },
  );
});
