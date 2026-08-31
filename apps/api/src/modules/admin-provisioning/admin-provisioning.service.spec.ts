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
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    accountInvitationDelivery: {
      create: jest.fn(),
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

  it('creates a pending resident and queues SMS without minting a credential', async () => {
    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      isActive: true,
    });

    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    prisma.user.create.mockResolvedValue({
      id: 'resident-1',
      email: 'resident@example.com',
      phoneNumber: '+2348024662124',
      firstName: 'Ada',
      lastName: 'Okafor',
      role: UserRole.USER,
      facilityId: 'facility-1',
      accountStatus: AccountStatus.PENDING_ACTIVATION,
      activationExpiresAt: null,
      invitedByUserId: 'admin-1',
    });

    prisma.accountInvitationDelivery.create.mockResolvedValue({
      id: 'delivery-1',
      channel: 'SMS',
      status: 'QUEUED',
      recipient: '+2348024662124',
      queuedAt: new Date(),
      nextAttemptAt: new Date(),
    });

    const result = await service.createResidentInvite('admin-1', {
      email: ' Resident@Example.COM ',
      phoneNumber: '08024662124',
      firstName: ' Ada ',
      lastName: ' Okafor ',
      facilityId: 'facility-1',
    });

    const userData = prisma.user.create.mock.calls[0][0].data;

    expect(userData.email).toBe('resident@example.com');
    expect(userData.phoneNumber).toBe('+2348024662124');
    expect(userData.firstName).toBe('Ada');
    expect(userData.lastName).toBe('Okafor');
    expect(userData.role).toBe(UserRole.USER);
    expect(userData.facilityId).toBe('facility-1');
    expect(userData.accountStatus).toBe(AccountStatus.PENDING_ACTIVATION);
    expect(userData.passwordHash).toBeNull();
    expect(userData.invitedByUserId).toBe('admin-1');
    expect(userData.activationTokenHash).toBeNull();
    expect(userData.activationExpiresAt).toBeNull();

    expect(prisma.accountInvitationDelivery.create).toHaveBeenCalledWith({
      data: {
        userId: 'resident-1',
        facilityId: 'facility-1',
        invitedByUserId: 'admin-1',
        channel: 'SMS',
        status: 'QUEUED',
        recipient: '+2348024662124',
      },
      select: {
        id: true,
        channel: true,
        status: true,
        recipient: true,
        queuedAt: true,
        nextAttemptAt: true,
      },
    });

    expect(result.user.id).toBe('resident-1');
    expect(result.delivery.id).toBe('delivery-1');
    expect(result.delivery.status).toBe('QUEUED');
    expect(result).not.toHaveProperty('activationToken');
    expect(result).not.toHaveProperty('activationPath');
  });
  it('rejects resident provisioning into an inactive or missing facility', async () => {
    prisma.facility.findUnique.mockResolvedValue(null);

    await expect(
      service.createResidentInvite('admin-1', {
        email: 'resident@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        facilityId: 'facility-missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate resident email', async () => {
    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      isActive: true,
    });

    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'existing' })
      .mockResolvedValueOnce(null);

    await expect(
      service.createResidentInvite('admin-1', {
        email: 'resident@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        facilityId: 'facility-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate resident phone number', async () => {
    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      isActive: true,
    });

    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing' });

    await expect(
      service.createResidentInvite('admin-1', {
        email: 'resident@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        facilityId: 'facility-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
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

  it('accepts an email alone', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
    });

    await expect(
      service.findResident({ email: 'ada@example.com' }),
    ).resolves.not.toBeNull();
  });

  it('accepts a phone number alone', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
    });

    await expect(
      service.findResident({ phoneNumber: '08024662124' }),
    ).resolves.not.toBeNull();
  });

  it('rejects a lookup with no identifier', async () => {
    await expect(service.findResident({})).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a lookup with both identifiers', async () => {
    // Silently preferring one would make the endpoint's behaviour depend
    // on an undocumented precedence rule.
    await expect(
      service.findResident({
        email: 'ada@example.com',
        phoneNumber: '08024662124',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('normalises an email before looking a resident up', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
    });

    await service.findResident({ email: '  Ada@Example.COM ' });

    // Registration stores the lowercased form, so anything else misses.
    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
      email: 'ada@example.com',
    });
  });

  it('normalises a phone number to E.164 before looking a resident up', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      role: UserRole.USER,
    });

    await service.findResident({ phoneNumber: '08024662124' });

    // THE POINT OF THIS TEST. An admin types the local form; registration
    // stored the canonical one. findByPhone deliberately does not
    // normalise its own argument, so if this boundary stops doing it the
    // lookup silently finds nothing and the admin concludes the resident
    // has no account.
    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
      phoneNumber: '+2348024662124',
    });
  });

  it('returns null for an identifier with no account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    // A question, not an error. 'No' is a useful answer to an admin
    // checking whether somebody has registered yet.
    await expect(
      service.findResident({ email: 'nobody@example.com' }),
    ).resolves.toBeNull();
  });

  it('returns null when the identifier belongs to an operator', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'operator-1',
      email: 'operator@example.com',
      role: UserRole.FACILITY_OPERATOR,
    });

    // The endpoint asks whether a RESIDENT exists. An operator is still
    // no - and saying 'that is an operator' would disclose that some
    // account exists, which the caller did not ask about.
    await expect(
      service.findResident({ email: 'operator@example.com' }),
    ).resolves.toBeNull();
  });

  it('reports a missing facility when listing members', async () => {
    prisma.facility.findUnique.mockResolvedValue(null);

    await expect(
      service.listFacilityMembers('facility-missing'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('partitions facility members by role from a single query', async () => {
    prisma.facility.findUnique.mockResolvedValue({
      id: 'facility-1',
      name: 'Lekki Estate',
      isActive: true,
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'op-1', role: UserRole.FACILITY_OPERATOR },
      { id: 'res-1', role: UserRole.USER },
      { id: 'res-2', role: UserRole.USER },
    ]);

    const result = await service.listFacilityMembers('facility-1');

    expect(result.operators.map((o) => o.id)).toEqual(['op-1']);
    expect(result.residents.map((r) => r.id)).toEqual(['res-1', 'res-2']);

    // One index scan, not two. Facility.staff is named for operators but
    // holds both, so the split belongs in code rather than in a second
    // query filtered by role.
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      facilityId: 'facility-1',
    });
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
