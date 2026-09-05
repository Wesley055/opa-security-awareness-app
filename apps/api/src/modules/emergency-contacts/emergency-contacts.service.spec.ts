import { EmergencyContactsService } from './emergency-contacts.service';

describe('EmergencyContactsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    emergencyContact: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const service = new EmergencyContactsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
  });

  it('creates an active contact and canonicalises the phone number', async () => {
    prisma.emergencyContact.create.mockResolvedValue({
      id: 'contact-1',
    });

    await service.create('user-1', {
      firstName: 'Ada',
      lastName: 'Okafor',
      relationship: 'Sister',
      phoneNumber: '08024662124',
    });

    expect(prisma.emergencyContact.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        firstName: 'Ada',
        lastName: 'Okafor',
        relationship: 'Sister',
        phoneNumber: '+2348024662124',
        email: undefined,
        isPrimary: false,
        isActive: true,
      },
    });
  });

  it('clears the previous primary when creating a new primary contact', async () => {
    prisma.emergencyContact.create.mockResolvedValue({
      id: 'contact-2',
    });

    await service.create('user-1', {
      firstName: 'Bola',
      lastName: 'Adeyemi',
      relationship: 'Mother',
      phoneNumber: '+2348012345678',
      isPrimary: true,
    });

    expect(prisma.emergencyContact.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        isPrimary: true,
      },
      data: {
        isPrimary: false,
      },
    });

    expect(prisma.emergencyContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPrimary: true,
        }),
      }),
    );
  });

  it('updates isActive without rewriting the stored phone number', async () => {
    prisma.emergencyContact.findFirst.mockResolvedValue({
      id: 'contact-1',
      userId: 'user-1',
    });

    prisma.emergencyContact.update.mockResolvedValue({
      id: 'contact-1',
    });

    await service.update('user-1', 'contact-1', {
      isActive: false,
    });

    const data = prisma.emergencyContact.update.mock.calls[0][0].data;

    expect(data.isActive).toBe(false);
    expect(data.phoneNumber).toBeUndefined();
  });

  it('persists an explicit emergency SMS opt-out when creating a contact', async () => {
    prisma.emergencyContact.create.mockResolvedValue({
      id: 'contact-1',
    });

    await service.create('user-1', {
      firstName: 'Ada',
      lastName: 'Okafor',
      relationship: 'Sister',
      phoneNumber: '08024662124',
      receivesEmergencySms: false,
    });

    expect(prisma.emergencyContact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receivesEmergencySms: false,
      }),
    });
  });

  it('updates the emergency SMS preference without rewriting the phone number', async () => {
    prisma.emergencyContact.findFirst.mockResolvedValue({
      id: 'contact-1',
      userId: 'user-1',
    });

    prisma.emergencyContact.update.mockResolvedValue({
      id: 'contact-1',
    });

    await service.update('user-1', 'contact-1', {
      receivesEmergencySms: false,
    });

    const data = prisma.emergencyContact.update.mock.calls[0][0].data;

    expect(data.receivesEmergencySms).toBe(false);
    expect(data.phoneNumber).toBeUndefined();
  });
  it('lists only the requesting user contacts with primary first', async () => {
    prisma.emergencyContact.findMany.mockResolvedValue([]);

    await service.listForUser('user-1');

    expect(prisma.emergencyContact.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
      },
      orderBy: [
        {
          isPrimary: 'desc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  });
});
