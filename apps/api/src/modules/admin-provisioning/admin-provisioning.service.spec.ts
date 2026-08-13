import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  FacilityType,
  UserRole,
} from '@prisma/client';
import { AdminProvisioningService } from './admin-provisioning.service';

describe('AdminProvisioningService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    facility: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const service = new AdminProvisioningService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );

    prisma.$executeRaw.mockResolvedValue(undefined);
  });

  it('creates a facility with server-owned lifecycle defaults', async () => {
    prisma.facility.create.mockResolvedValue({
      id: 'facility-1',
    });

    await service.createFacility({
      name: 'Lekki Estate Security',
      type: FacilityType.SECURITY_PROVIDER,
      address: 'Lekki',
      phoneNumber: '+2348012345678',
    });

    expect(prisma.facility.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Lekki Estate Security',
        type: FacilityType.SECURITY_PROVIDER,
        phoneNumber: '+2348012345678',
      }),
    });

    const data = prisma.facility.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('isVerified');
    expect(data).not.toHaveProperty('isActive');
  });

  it('creates a pending facility operator and never stores the raw token', async () => {
    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      isActive: true,
    });

    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    prisma.user.create.mockResolvedValue({
      id: 'operator-1',
      email: 'operator@example.com',
      phoneNumber: '+2348012345678',
      firstName: 'Ada',
      lastName: 'Okafor',
      role: UserRole.FACILITY_OPERATOR,
      facilityId: 'facility-1',
      accountStatus: AccountStatus.PENDING_ACTIVATION,
      activationExpiresAt: new Date(),
      invitedByUserId: 'admin-1',
    });

    const result = await service.createOperatorSeat('admin-1', {
      email: 'Operator@Example.com',
      phoneNumber: '+2348012345678',
      firstName: 'Ada',
      lastName: 'Okafor',
      facilityId: 'facility-1',
    });

    expect(result.activationToken).toEqual(expect.any(String));
    expect(result.activationToken.length).toBeGreaterThan(30);
    expect(result.activationPath).toContain(result.activationToken);

    const data = prisma.user.create.mock.calls[0][0].data;

    expect(data.role).toBe(UserRole.FACILITY_OPERATOR);
    expect(data.accountStatus).toBe(
      AccountStatus.PENDING_ACTIVATION,
    );
    expect(data.passwordHash).toBeNull();
    expect(data.facilityId).toBe('facility-1');
    expect(data.invitedByUserId).toBe('admin-1');
    expect(data.activationTokenHash).toEqual(expect.any(String));
    expect(data.activationTokenHash).not.toBe(result.activationToken);
  });

  it('rejects operator provisioning into an inactive or missing facility', async () => {
    prisma.facility.findUnique.mockResolvedValue(null);

    await expect(
      service.createOperatorSeat('admin-1', {
        email: 'operator@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        facilityId: 'facility-missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate operator email', async () => {
    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      isActive: true,
    });

    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'existing' })
      .mockResolvedValueOnce(null);

    await expect(
      service.createOperatorSeat('admin-1', {
        email: 'operator@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        facilityId: 'facility-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a duplicate operator phone number', async () => {
    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      isActive: true,
    });

    // Email is free, phone is taken. The checks are sequential, so this
    // reaches the phone lookup only because the email one returned null.
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing' });

    await expect(
      service.createOperatorSeat('admin-1', {
        email: 'newoperator@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        facilityId: 'facility-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('takes the user lock before resident membership changes', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
      facilityId: null,
    });

    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      isActive: true,
    });

    prisma.user.update.mockResolvedValue({
      id: 'resident-1',
      email: 'resident@example.com',
      role: UserRole.USER,
      facilityId: 'facility-1',
    });

    await service.assignResidentToFacility(
      'resident-1',
      'facility-1',
    );

    const lockOrder =
      prisma.$executeRaw.mock.invocationCallOrder[0];
    const readOrder =
      prisma.user.findUnique.mock.invocationCallOrder[0];
    const updateOrder =
      prisma.user.update.mock.invocationCallOrder[0];

    if (
      lockOrder === undefined ||
      readOrder === undefined ||
      updateOrder === undefined
    ) {
      throw new Error(
        'Expected lock, resident read, and membership update.',
      );
    }

    expect(lockOrder).toBeLessThan(readOrder);
    expect(readOrder).toBeLessThan(updateOrder);
  });

  it('rejects assigning a non-USER account as a resident', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'operator-1',
      role: UserRole.FACILITY_OPERATOR,
      facilityId: 'facility-1',
    });

    await expect(
      service.assignResidentToFacility(
        'operator-1',
        'facility-2',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects removal when the resident belongs to another facility', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
      facilityId: 'facility-b',
    });

    // The admin is looking at facility-a's roster. Somebody moved this
    // resident to facility-b. Removing must fail, not detach them from b.
    await expect(
      service.removeResidentFromFacility('resident-1', 'facility-a'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects removal when the resident is already unassigned', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
      facilityId: null,
    });

    // The previous version wrote facilityId: null over null and reported
    // success, so an admin could not tell a removal from a no-op.
    await expect(
      service.removeResidentFromFacility('resident-1', 'facility-a'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('removes resident membership under the same user lock', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
      facilityId: 'facility-1',
    });

    prisma.user.update.mockResolvedValue({
      id: 'resident-1',
      email: 'resident@example.com',
      role: UserRole.USER,
      facilityId: null,
    });

    const result =
      await service.removeResidentFromFacility('resident-1', 'facility-1');

    expect(result.facilityId).toBeNull();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { facilityId: null },
      }),
    );
  });
});
