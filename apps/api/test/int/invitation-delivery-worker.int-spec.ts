import { FacilityType, type Facility, type User } from '@prisma/client';
import { prismaTest } from './prisma-test-client';
import { InvitationDeliveryWorker } from '../../src/modules/admin-provisioning/invitation-delivery.worker';

describe('InvitationDeliveryWorker integration', () => {
  const MINUTE = 60_000;

  async function createFacility(): Promise<Facility> {
    return prismaTest.facility.create({
      data: { name: 'Int Test Estate', type: FacilityType.SECURITY_PROVIDER, isActive: true },
    });
  }

  async function createPendingResident(facilityId: string): Promise<User> {
    return prismaTest.user.create({
      data: {
        email: 'resident-' + Date.now() + '-' + Math.random() + '@example.test',
        phoneNumber: '+234' + String(800000000 + Math.floor(Math.random() * 1e8)),
        passwordHash: null,
        firstName: 'Pending',
        lastName: 'Resident',
        role: 'USER',
        facilityId,
        accountStatus: 'PENDING_ACTIVATION',
      },
    });
  }

  async function queueDelivery(
    user: User,
    facilityId: string,
    overrides: {
      status?: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
      nextAttemptAt?: Date;
      lastAttemptAt?: Date;
      attemptCount?: number;
    } = {},
  ) {
    return prismaTest.accountInvitationDelivery.create({
      data: {
        userId: user.id,
        facilityId,
        channel: 'SMS',
        status: overrides.status ?? 'QUEUED',
        recipient: user.phoneNumber,
        attemptCount: overrides.attemptCount ?? 0,
        nextAttemptAt: overrides.nextAttemptAt ?? new Date(Date.now() - MINUTE),
        lastAttemptAt: overrides.lastAttemptAt,
      },
    });
  }

  function buildWorker(send: jest.Mock) {
    return new InvitationDeliveryWorker(prismaTest as never, { send } as never);
  }

  it('sends a due delivery and stores only the provider outcome', async () => {
    const facility = await createFacility();
    const user = await createPendingResident(facility.id);
    const delivery = await queueDelivery(user, facility.id);
    const send = jest.fn().mockResolvedValue({
      success: true,
      provider: 'AfricasTalking',
      messageId: 'ATXid_integration',
    });

    await buildWorker(send).tick();

    const row = await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(row.status).toBe('SENT');
    expect(row.providerMessageId).toBe('ATXid_integration');
    expect(row.sentAt).not.toBeNull();
    expect(row.attemptCount).toBe(1);

    const claimed = await prismaTest.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(claimed.activationTokenHash).not.toBeNull();
    expect(claimed.activationExpiresAt).not.toBeNull();

    const message = send.mock.calls[0][0].message as string;
    expect(message).toContain('Int Test Estate');
    expect(JSON.stringify(row)).not.toContain(message);
  });

  it('does not claim a row whose nextAttemptAt is still in the future', async () => {
    const facility = await createFacility();
    const user = await createPendingResident(facility.id);
    const delivery = await queueDelivery(user, facility.id, {
      nextAttemptAt: new Date(Date.now() + 10 * MINUTE),
    });

    const send = jest.fn();
    await buildWorker(send).tick();
    expect(send).not.toHaveBeenCalled();

    const row = await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(row.status).toBe('QUEUED');
    expect(row.attemptCount).toBe(0);
  });

  it('never reclaims a terminal row', async () => {
    const facility = await createFacility();
    const sentUser = await createPendingResident(facility.id);
    await queueDelivery(sentUser, facility.id, { status: 'SENT' });
    const failedUser = await createPendingResident(facility.id);
    await queueDelivery(failedUser, facility.id, { status: 'FAILED' });

    const send = jest.fn();
    await buildWorker(send).tick();
    expect(send).not.toHaveBeenCalled();
  });

  it('recovers a row abandoned in SENDING and leaves a fresh one alone', async () => {
    const facility = await createFacility();
    const abandonedUser = await createPendingResident(facility.id);
    const abandoned = await queueDelivery(abandonedUser, facility.id, {
      status: 'SENDING',
      attemptCount: 1,
      lastAttemptAt: new Date(Date.now() - 30 * MINUTE),
    });
    const inFlightUser = await createPendingResident(facility.id);
    const inFlight = await queueDelivery(inFlightUser, facility.id, {
      status: 'SENDING',
      attemptCount: 1,
      lastAttemptAt: new Date(),
    });

    const send = jest.fn().mockResolvedValue({
      success: true,
      provider: 'AfricasTalking',
      messageId: 'ATXid_recovered',
    });
    await buildWorker(send).tick();

    const recovered = await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
      where: { id: abandoned.id },
    });
    const untouched = await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
      where: { id: inFlight.id },
    });
    expect(recovered.attemptCount).toBeGreaterThan(1);
    expect(untouched.status).toBe('SENDING');
    expect(untouched.attemptCount).toBe(1);
  });

  it('requeues with backoff when the provider rejects the send', async () => {
    const facility = await createFacility();
    const user = await createPendingResident(facility.id);
    const delivery = await queueDelivery(user, facility.id);
    const send = jest.fn().mockResolvedValue({
      success: false,
      provider: 'AfricasTalking',
      error: 'Gateway timeout',
    });

    const before = Date.now();
    await buildWorker(send).tick();

    const row = await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(row.status).toBe('QUEUED');
    expect(row.attemptCount).toBe(1);
    expect(row.lastError).toContain('Gateway timeout');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(before);
  });

  it('only one of two concurrent workers claims the same delivery', async () => {
    const facility = await createFacility();
    const user = await createPendingResident(facility.id);
    await queueDelivery(user, facility.id);

    const sendA = jest.fn().mockResolvedValue({
      success: true,
      provider: 'AfricasTalking',
      messageId: 'ATXid_a',
    });
    const sendB = jest.fn().mockResolvedValue({
      success: true,
      provider: 'AfricasTalking',
      messageId: 'ATXid_b',
    });

    await Promise.all([buildWorker(sendA).tick(), buildWorker(sendB).tick()]);

    const sends = sendA.mock.calls.length + sendB.mock.calls.length;
    expect(sends).toBe(1);
  });
});
