import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IncidentStatus } from '@prisma/client';
import { FacilitiesService } from './facilities.service';

describe('FacilitiesService', () => {
  const prisma = {
    facility: { findUnique: jest.fn() },
    incident: { findMany: jest.fn() },
  };

  const service = new FacilitiesService(prisma as never);

  const AT = new Date('2026-08-12T01:00:00.000Z');

  const row = (id: string, createdAt: Date = AT) => ({
    id,
    createdAt,
    status: IncidentStatus.OPEN,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.facility.findUnique.mockResolvedValue({ id: 'facility-1' });
    prisma.incident.findMany.mockResolvedValue([]);
  });

  const lastWhere = () => prisma.incident.findMany.mock.calls[0][0].where;
  const lastArgs = () => prisma.incident.findMany.mock.calls[0][0];

  it('reports a missing facility as not found', async () => {
    prisma.facility.findUnique.mockResolvedValue(null);

    await expect(
      service.listIncidentsForFacility('nope'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });

  // THE DELIBERATE OMISSION. Deactivation is not a revocation workflow:
  // incidents still route to an inactive facility, so hiding the queue
  // would leave live emergencies visible to nobody.
  it('still returns the queue for an inactive facility', async () => {
    prisma.incident.findMany.mockResolvedValue([row('incident-1')]);

    const result = await service.listIncidentsForFacility('facility-1');

    expect(result.incidents).toHaveLength(1);

    // The existence check must not select isActive either - selecting it
    // would invite a future edit to start filtering on it.
    const select = prisma.facility.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('isActive');
  });

  it('defaults to the live statuses', async () => {
    await service.listIncidentsForFacility('facility-1');

    expect(lastWhere().facilityId).toBe('facility-1');
    expect(lastWhere().status).toEqual({
      in: [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED],
    });
  });

  it('honours an explicit status filter', async () => {
    await service.listIncidentsForFacility('facility-1', {
      status: IncidentStatus.RESOLVED,
    });

    expect(lastWhere().status).toEqual({ equals: IncidentStatus.RESOLVED });
  });

  it('orders by createdAt then id, both descending', async () => {
    await service.listIncidentsForFacility('facility-1');

    expect(lastArgs().orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('never selects timeline events, notifications or evidence', async () => {
    await service.listIncidentsForFacility('facility-1');

    const args = lastArgs();

    // A list view that drags the whole hash chain along is how an operator
    // console becomes unusable at the first busy estate.
    expect(args.select).not.toHaveProperty('timelineEvents');
    expect(args.select).not.toHaveProperty('notifications');
    expect(args.select).not.toHaveProperty('evidence');
    expect(args.include).toBeUndefined();

    // And nothing OPA cannot populate honestly.
    expect(args.select).not.toHaveProperty('acknowledgedAt');

    // The cursor needs both of these, so their absence would break paging
    // silently rather than loudly.
    expect(args.select.createdAt).toBe(true);
    expect(args.select.id).toBe(true);
  });

  it('defaults to 25 and asks for one extra row', async () => {
    await service.listIncidentsForFacility('facility-1');

    expect(lastArgs().take).toBe(26);
  });

  it('clamps take to the 100 ceiling', async () => {
    await service.listIncidentsForFacility('facility-1', { take: 5000 });

    expect(lastArgs().take).toBe(101);
  });

  // THE CURSOR CONTRACT. Prisma's own cursor option resolves a row by
  // unique id regardless of the facility and status filter; these pin that
  // paging is expressed as a predicate in the same terms as the ordering.
  it('uses no Prisma cursor or skip', async () => {
    await service.listIncidentsForFacility('facility-1', {
      cursor: Buffer.from(
        JSON.stringify({ c: AT.toISOString(), i: 'incident-9' }),
      ).toString('base64url'),
    });

    expect(lastArgs().cursor).toBeUndefined();
    expect(lastArgs().skip).toBeUndefined();
  });

  it('applies a compound seek predicate matching the ordering', async () => {
    await service.listIncidentsForFacility('facility-1', {
      cursor: Buffer.from(
        JSON.stringify({ c: AT.toISOString(), i: 'incident-9' }),
      ).toString('base64url'),
    });

    expect(lastWhere().OR).toEqual([
      { createdAt: { lt: AT } },
      { AND: [{ createdAt: AT }, { id: { lt: 'incident-9' } }] },
    ]);
  });

  it('applies no seek predicate on the first page', async () => {
    await service.listIncidentsForFacility('facility-1');

    expect(lastWhere().OR).toBeUndefined();
  });

  it('rejects a malformed cursor rather than restarting the queue', async () => {
    // Silently serving page one would show an operator the same
    // emergencies again and hide everything below where they had reached.
    await expect(
      service.listIncidentsForFacility('facility-1', {
        cursor: 'not-a-real-cursor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });

  it('rejects a cursor carrying an unparseable date', async () => {
    await expect(
      service.listIncidentsForFacility('facility-1', {
        cursor: Buffer.from(
          JSON.stringify({ c: 'never', i: 'incident-9' }),
        ).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trims the extra row and emits a cursor for the last shown row', async () => {
    const older = new Date(AT.getTime() - 1000);
    prisma.incident.findMany.mockResolvedValue([
      row('a', AT),
      row('b', older),
      row('c', older),
    ]);

    const result = await service.listIncidentsForFacility('facility-1', {
      take: 2,
    });

    expect(result.incidents.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.hasMore).toBe(true);

    const decoded = JSON.parse(
      Buffer.from(result.nextCursor as string, 'base64url').toString('utf8'),
    );
    expect(decoded.i).toBe('b');
    expect(decoded.c).toBe(older.toISOString());
  });

  it('round-trips its own cursor into the next seek predicate', async () => {
    const older = new Date(AT.getTime() - 1000);
    prisma.incident.findMany.mockResolvedValue([
      row('a', AT),
      row('b', older),
      row('c', older),
    ]);

    const first = await service.listIncidentsForFacility('facility-1', {
      take: 2,
    });

    jest.clearAllMocks();
    prisma.facility.findUnique.mockResolvedValue({ id: 'facility-1' });
    prisma.incident.findMany.mockResolvedValue([]);

    await service.listIncidentsForFacility('facility-1', {
      take: 2,
      cursor: first.nextCursor as string,
    });

    // The encoder and the decoder must agree, or paging works in tests and
    // silently repeats a page in production.
    expect(lastWhere().OR).toEqual([
      { createdAt: { lt: older } },
      { AND: [{ createdAt: older }, { id: { lt: 'b' } }] },
    ]);
  });

  it('reports the end of the queue with a null cursor', async () => {
    prisma.incident.findMany.mockResolvedValue([row('a')]);

    const result = await service.listIncidentsForFacility('facility-1', {
      take: 2,
    });

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});