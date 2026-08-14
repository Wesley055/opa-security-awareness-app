import { NotFoundException } from '@nestjs/common';
import { IncidentDetailService } from './incident-detail.service';

/**
 * Coverage for the detail PROJECTION, which is a published contract the
 * operator console reads through its same-origin bridge.
 *
 * THE PROJECTION TESTS ASSERT ON ARGUMENTS, NOT RESULTS. Which columns
 * leave the database is the only thing that can leak; a mocked return value
 * would prove nothing about the select.
 *
 * NOT ALL REJECTIONS. One test refuses a missing incident, one returns a
 * real row, and three pin the shape - a service that threw for everything
 * would pass a refusal-only suite completely.
 */
describe('IncidentDetailService.getDetail', () => {
  function makePrisma(row: unknown) {
    return { incident: { findUnique: jest.fn().mockResolvedValue(row) } };
  }

  function selectArg(prisma: ReturnType<typeof makePrisma>) {
    return prisma.incident.findUnique.mock.calls[0][0].select;
  }

  const ROW = { id: 'incident-1', status: 'OPEN' };

  it('queries by id and returns the row', async () => {
    const prisma = makePrisma(ROW);
    const result = await new IncidentDetailService(prisma as never).getDetail(
      'incident-1',
    );

    expect(prisma.incident.findUnique.mock.calls[0][0].where).toEqual({
      id: 'incident-1',
    });
    expect(result).toBe(ROW);
  });

  it('throws when the incident does not exist', async () => {
    // Unreachable through the controller - IncidentAccessGuard 404s first -
    // but a service must not assume its only caller.
    const prisma = makePrisma(null);

    await expect(
      new IncidentDetailService(prisma as never).getDetail('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('selects exactly the agreed detail fields', async () => {
    // toEqual on the whole select: this fails if a field is dropped AND if
    // one is added, which is the half that keeps internal columns out.
    const prisma = makePrisma(ROW);
    await new IncidentDetailService(prisma as never).getDetail('incident-1');

    expect(selectArg(prisma)).toEqual({
      id: true,
      status: true,
      trigger: true,
      latitude: true,
      longitude: true,
      address: true,
      voicePhrase: true,
      lastTriggeredAt: true,
      retriggerCount: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      journeySessionId: true,
      user: { select: { firstName: true, lastName: true } },
    });
  });

  it('never selects the internal JSON blobs', async () => {
    // Named separately from the toEqual above because the reason differs:
    // metadata holds dispatch plumbing and trustedContact may carry a third
    // party's details. Neither belongs in a console response.
    const prisma = makePrisma(ROW);
    await new IncidentDetailService(prisma as never).getDetail('incident-1');

    const select = selectArg(prisma);
    expect(select.metadata).toBeUndefined();
    expect(select.trustedContact).toBeUndefined();
  });

  it('exposes only a display name from the related user', async () => {
    // Not the email, phone number, or id of the person in the emergency.
    const prisma = makePrisma(ROW);
    await new IncidentDetailService(prisma as never).getDetail('incident-1');

    expect(selectArg(prisma).user.select).toEqual({
      firstName: true,
      lastName: true,
    });
  });
});