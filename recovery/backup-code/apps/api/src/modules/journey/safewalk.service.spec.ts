import { ConflictException, NotFoundException } from '@nestjs/common';
import { SafeWalkService } from './safewalk.service';

describe('SafeWalk owner confirmations', () => {
  const confirmedAt = new Date('2026-09-09T01:00:00Z');
  function makeTx() {
    return {
      $transaction: jest.fn(), $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ confirmed_at: confirmedAt }]),
      journeySession: {
        findFirst: jest.fn().mockResolvedValue({ id: 'session', status: 'ACTIVE' }),
        update: jest.fn(),
      },
      incident: { findFirst: jest.fn().mockResolvedValue(null) },
      safeWalkEscalation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      safeWalkNotice: { updateMany: jest.fn() },
      safeWalkAudit: { create: jest.fn() },
    };
  }
  let tx: ReturnType<typeof makeTx>;
  let journeys: { endSession: jest.Mock };
  let service: SafeWalkService;
  beforeEach(() => {
    tx = makeTx();
    tx.$transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
    journeys = { endSession: jest.fn() };
    service = new SafeWalkService(tx as never, journeys as never);
  });
  it('uses owner and SafeWalk scope for status; gives unknown and other owners the same 404', async () => {
    tx.journeySession.findFirst.mockResolvedValue(null);
    await expect(service.getStatus('owner', 'session')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.journeySession.findFirst.mock.calls[0][0].where).toEqual({
      id: 'session', userId: 'owner', purpose: 'SAFEWALK', redactedAt: null,
    });
  });
  it('does not end tracking or mutate incidents when safety is confirmed', async () => {
    const result = await service.confirm('owner', 'session', 'SAFETY');
    expect(result.confirmedAt).toEqual(confirmedAt);
    expect(journeys.endSession).not.toHaveBeenCalled();
    expect(tx.incident.findFirst).not.toHaveBeenCalled();
    expect(tx.journeySession.update).toHaveBeenCalledWith({
      where: { id: 'session' }, data: { safetyConfirmedAt: confirmedAt },
    });
  });
  it('preserves the first confirmation on a retry', async () => {
    tx.journeySession.findFirst.mockResolvedValue({ status: 'ENDED', arrivalConfirmedAt: confirmedAt });
    expect(await service.confirm('owner', 'session', 'ARRIVAL')).toEqual({
      sessionId: 'session', kind: 'ARRIVAL', confirmedAt, alreadyConfirmed: true,
    });
    expect(tx.journeySession.update).not.toHaveBeenCalled();
    expect(journeys.endSession).not.toHaveBeenCalled();
  });
  it('rejects new confirmations for ended journeys', async () => {
    tx.journeySession.findFirst.mockResolvedValue({ status: 'ENDED' });
    await expect(service.confirm('owner', 'session', 'SAFETY')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.journeySession.update).not.toHaveBeenCalled();
  });
  it('does not terminate telemetry while an emergency remains active', async () => {
    tx.incident.findFirst.mockResolvedValue({ id: 'emergency' });
    await expect(service.confirm('owner', 'session', 'ARRIVAL')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.journeySession.update).not.toHaveBeenCalled();
    expect(journeys.endSession).not.toHaveBeenCalled();
  });
  it('records arrival and ends the journey in the same transaction', async () => {
    await service.confirm('owner', 'session', 'ARRIVAL');
    expect(journeys.endSession).toHaveBeenCalledWith(tx, 'owner', 'session');
    expect(tx.journeySession.update).toHaveBeenCalledWith({
      where: { id: 'session' }, data: { arrivalConfirmedAt: confirmedAt },
    });
  });
  it('fails without writing when the database clock is unavailable', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.confirm('owner', 'session', 'SAFETY')).rejects.toThrow('clock unavailable');
    expect(tx.journeySession.update).not.toHaveBeenCalled();
  });
});
