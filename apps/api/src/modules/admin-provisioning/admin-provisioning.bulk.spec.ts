import { ConflictException } from '@nestjs/common';
import { AdminProvisioningService } from './admin-provisioning.service';
import { CreateResidentDto } from './dto/create-resident.dto';

describe('AdminProvisioningService bulk resident provisioning', () => {
  const prisma: any = {};
  let service: AdminProvisioningService;

  const resident = (email: string): CreateResidentDto => ({
    email,
    phoneNumber: '+2348000000000',
    firstName: 'Test',
    lastName: 'Resident',
    facilityId: '11111111-1111-1111-1111-111111111111',
  });

  beforeEach(() => {
    service = new AdminProvisioningService(prisma);
  });

  it('processes rows independently and reports partial success', async () => {
    const spy = jest
      .spyOn(service, 'createResidentInvite')
      .mockResolvedValueOnce({
        user: { id: 'user-1' } as never,
        delivery: { id: 'delivery-1', status: 'QUEUED' } as never,
      })
      .mockRejectedValueOnce(new ConflictException('Email already exists.'))
      .mockResolvedValueOnce({
        user: { id: 'user-3' } as never,
        delivery: { id: 'delivery-3', status: 'QUEUED' } as never,
      });

    const result = await service.createBulkResidentInvites(
      'admin-1',
      [
        resident('one@example.com'),
        resident('duplicate@example.com'),
        resident('three@example.com'),
      ],
    );

    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.total).toBe(3);
    expect(result.queued).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({ index: 0, status: 'QUEUED' });
    expect(result.results[1]).toMatchObject({
      index: 1,
      status: 'FAILED',
      error: { statusCode: 409, message: 'Email already exists.' },
    });
    expect(result.results[2]).toMatchObject({ index: 2, status: 'QUEUED' });
  });

  it('does not expose unexpected internal errors and continues later rows', async () => {
    const spy = jest
      .spyOn(service, 'createResidentInvite')
      .mockRejectedValueOnce(
        new Error('DATABASE_URL=secret provider credential leaked'),
      )
      .mockResolvedValueOnce({
        user: { id: 'user-2' } as never,
        delivery: { id: 'delivery-2', status: 'QUEUED' } as never,
      });

    const result = await service.createBulkResidentInvites(
      'admin-1',
      [resident('one@example.com'), resident('two@example.com')],
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.results[0]).toEqual({
      index: 0,
      status: 'FAILED',
      error: {
        statusCode: 500,
        message: 'Resident provisioning failed.',
      },
    });
  });
});
