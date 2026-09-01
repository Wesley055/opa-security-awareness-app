import { ForbiddenException } from '@nestjs/common';
import { FacilityAdminGuard } from './facility-admin.guard';

describe('FacilityAdminGuard', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const guard = new FacilityAdminGuard(prisma as never);

  function makeContext() {
    const request = {
      user: { sub: 'facility-admin-1' },
    } as any;

    return {
      request,
      context: {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as any,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('authorizes active FACILITY_ADMIN and derives facility from Postgres', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_ADMIN',
      facilityId: 'facility-1',
      isActive: true,
      accountStatus: 'ACTIVE',
    });

    const { request, context } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.facilityAdminFacilityId).toBe('facility-1');
  });

  it('refuses FACILITY_OPERATOR resident-administration authority', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-1',
      isActive: true,
      accountStatus: 'ACTIVE',
    });

    await expect(guard.canActivate(makeContext().context))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses platform ADMIN on the own-facility admin route', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ADMIN',
      facilityId: 'facility-1',
      isActive: true,
      accountStatus: 'ACTIVE',
    });

    await expect(guard.canActivate(makeContext().context))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses pending activation', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_ADMIN',
      facilityId: 'facility-1',
      isActive: true,
      accountStatus: 'PENDING_ACTIVATION',
    });

    await expect(guard.canActivate(makeContext().context))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses inactive account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_ADMIN',
      facilityId: 'facility-1',
      isActive: false,
      accountStatus: 'ACTIVE',
    });

    await expect(guard.canActivate(makeContext().context))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses unassigned facility administrator', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_ADMIN',
      facilityId: null,
      isActive: true,
      accountStatus: 'ACTIVE',
    });

    await expect(guard.canActivate(makeContext().context))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
