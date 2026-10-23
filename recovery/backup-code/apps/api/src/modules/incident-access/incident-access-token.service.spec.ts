import { IncidentStatus, TrackingAccessScope } from '@prisma/client';
import { createHash } from 'crypto';
import { IncidentAccessTokenService } from './incident-access-token.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('IncidentAccessTokenService', () => {
  const prisma = {
    incidentAccessToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: IncidentAccessTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IncidentAccessTokenService(prisma as never);
    prisma.incidentAccessToken.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'token-row-1',
        ...data,
      }),
    );
    prisma.incidentAccessToken.update.mockResolvedValue({});
    prisma.$transaction.mockResolvedValue([]);
  });

  const sha256 = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  describe('issue', () => {
    it('returns a raw token and never persists it', async () => {
      const result = await service.issue('incident-1');

      expect(result.token).toEqual(expect.any(String));

      const created = prisma.incidentAccessToken.create.mock.calls[0][0].data;
      // The stored value must be the HASH, not the token itself.
      expect(created.tokenHash).not.toBe(result.token);
      expect(created.tokenHash).toBe(sha256(result.token));
      expect(JSON.stringify(created)).not.toContain(result.token);
    });

    it('generates a URL-safe 128-bit token', async () => {
      const result = await service.issue('incident-1');

      // 16 random bytes base64url encoded, no padding.
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it('generates a different token every time', async () => {
      const first = await service.issue('incident-1');
      const second = await service.issue('incident-1');

      expect(first.token).not.toBe(second.token);
    });

    it('sets a six hour initial validity and a seven day ceiling', async () => {
      const before = Date.now();
      await service.issue('incident-1');
      const after = Date.now();

      const created = prisma.incidentAccessToken.create.mock.calls[0][0].data;
      const expiresAt = (created.expiresAt as Date).getTime();
      const absolute = (created.absoluteExpiry as Date).getTime();

      expect(expiresAt).toBeGreaterThanOrEqual(before + 6 * HOUR);
      expect(expiresAt).toBeLessThanOrEqual(after + 6 * HOUR);
      expect(absolute).toBeGreaterThanOrEqual(before + 7 * DAY);
      expect(absolute).toBeLessThanOrEqual(after + 7 * DAY);
    });

    it('defaults to family bearer scope', async () => {
      await service.issue('incident-1');

      const created = prisma.incidentAccessToken.create.mock.calls[0][0].data;
      expect(created.scope).toBe(TrackingAccessScope.FAMILY_BEARER);
    });

    it('honours an explicit scope', async () => {
      await service.issue(
        'incident-1',
        TrackingAccessScope.AUTHORIZED_RESPONDER,
      );

      const created = prisma.incidentAccessToken.create.mock.calls[0][0].data;
      expect(created.scope).toBe(TrackingAccessScope.AUTHORIZED_RESPONDER);
    });
  });

  describe('resolve', () => {
    const liveToken = {
      id: 'token-row-1',
      incidentId: 'incident-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + HOUR),
      absoluteExpiry: new Date(Date.now() + 6 * DAY),
      incident: { id: 'incident-1', status: IncidentStatus.OPEN },
    };

    it('looks the token up by hash, never by raw value', async () => {
      prisma.incidentAccessToken.findUnique.mockResolvedValue(liveToken);

      await service.resolve('some-raw-token');

      const where = prisma.incidentAccessToken.findUnique.mock.calls[0][0].where;
      expect(where.tokenHash).toBe(sha256('some-raw-token'));
    });

    it('returns the incident alongside the token so callers need no second query', async () => {
      prisma.incidentAccessToken.findUnique.mockResolvedValue(liveToken);

      const result = await service.resolve('raw');

      expect(result.status).toBe('VALID');
      const include =
        prisma.incidentAccessToken.findUnique.mock.calls[0][0].include;
      expect(include).toEqual({ incident: true });
    });

    it('reports NOT_FOUND for an unknown token', async () => {
      prisma.incidentAccessToken.findUnique.mockResolvedValue(null);

      expect(await service.resolve('nope')).toEqual({ status: 'NOT_FOUND' });
    });

    it('reports REVOKED separately from EXPIRED', async () => {
      prisma.incidentAccessToken.findUnique.mockResolvedValue({
        ...liveToken,
        revokedAt: new Date(),
      });

      const result = await service.resolve('raw');

      // These must stay distinct: telling a family "this incident ended" when
      // a link merely expired could convince them the emergency is over.
      expect(result.status).toBe('REVOKED');
    });

    it('reports EXPIRED when the rolling expiry has passed', async () => {
      prisma.incidentAccessToken.findUnique.mockResolvedValue({
        ...liveToken,
        expiresAt: new Date(Date.now() - 1000),
      });

      expect((await service.resolve('raw')).status).toBe('EXPIRED');
    });

    it('reports EXPIRED when the absolute ceiling has passed even if the rolling expiry has not', async () => {
      prisma.incidentAccessToken.findUnique.mockResolvedValue({
        ...liveToken,
        expiresAt: new Date(Date.now() + HOUR),
        absoluteExpiry: new Date(Date.now() - 1000),
      });

      expect((await service.resolve('raw')).status).toBe('EXPIRED');
    });

    it('does not mutate the token when resolving', async () => {
      prisma.incidentAccessToken.findUnique.mockResolvedValue(liveToken);

      await service.resolve('raw');

      expect(prisma.incidentAccessToken.update).not.toHaveBeenCalled();
    });
  });

  describe('recordAccess', () => {
    it('increments the access count without extending validity', async () => {
      await service.recordAccess('token-row-1');

      const args = prisma.incidentAccessToken.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'token-row-1' });
      expect(args.data.accessCount).toEqual({ increment: 1 });
      expect(args.data.lastAccessedAt).toBeInstanceOf(Date);
      // Critical: viewing a link must NOT keep it alive. Otherwise anyone
      // holding a forwarded link could extend it indefinitely by reopening it.
      expect(args.data).not.toHaveProperty('expiresAt');
      expect(args.data).not.toHaveProperty('absoluteExpiry');
    });
  });

  describe('revokeAllForIncident', () => {
    it('revokes only tokens that are still live', async () => {
      prisma.incidentAccessToken.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.revokeAllForIncident('incident-1');

      expect(count).toBe(3);
      const args = prisma.incidentAccessToken.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({ incidentId: 'incident-1', revokedAt: null });
      expect(args.data.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('renewEligibleTokens', () => {
    const now = new Date('2026-07-24T12:00:00.000Z');

    it('only considers unrevoked tokens on OPEN incidents within the renewal window', async () => {
      prisma.incidentAccessToken.findMany.mockResolvedValue([]);

      await service.renewEligibleTokens(now);

      const where = prisma.incidentAccessToken.findMany.mock.calls[0][0].where;
      expect(where.revokedAt).toBeNull();
      expect(where.incident).toEqual({ status: IncidentStatus.OPEN });
      expect(where.absoluteExpiry.gt).toEqual(now);
      // Only tokens close to expiring, so the job does not rewrite every live
      // token on every tick.
      expect(where.expiresAt.lte).toEqual(new Date(now.getTime() + HOUR));
    });

    it('extends an eligible token by six hours', async () => {
      prisma.incidentAccessToken.findMany.mockResolvedValue([
        {
          id: 'token-row-1',
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          absoluteExpiry: new Date(now.getTime() + 5 * DAY),
        },
      ]);

      const renewed = await service.renewEligibleTokens(now);

      expect(renewed).toBe(1);
      const args = prisma.incidentAccessToken.update.mock.calls[0][0];
      expect(args.data.expiresAt).toEqual(new Date(now.getTime() + 6 * HOUR));
    });

    it('clamps the new expiry to the absolute ceiling', async () => {
      prisma.incidentAccessToken.findMany.mockResolvedValue([
        {
          id: 'token-row-1',
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          // Ceiling is only two hours away, so a six hour extension must be
          // cut short rather than pushing past it.
          absoluteExpiry: new Date(now.getTime() + 2 * HOUR),
        },
      ]);

      await service.renewEligibleTokens(now);

      const args = prisma.incidentAccessToken.update.mock.calls[0][0];
      expect(args.data.expiresAt).toEqual(new Date(now.getTime() + 2 * HOUR));
    });

    it('skips tokens already pinned to their ceiling', async () => {
      prisma.incidentAccessToken.findMany.mockResolvedValue([
        {
          id: 'token-row-1',
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
          // Already at the ceiling: a "renewal" would rewrite the same value.
          absoluteExpiry: new Date(now.getTime() + 30 * 60 * 1000),
        },
      ]);

      const renewed = await service.renewEligibleTokens(now);

      expect(renewed).toBe(0);
      expect(prisma.incidentAccessToken.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('batches renewals into a single transaction', async () => {
      prisma.incidentAccessToken.findMany.mockResolvedValue([
        {
          id: 'a',
          expiresAt: new Date(now.getTime() + 60_000),
          absoluteExpiry: new Date(now.getTime() + 5 * DAY),
        },
        {
          id: 'b',
          expiresAt: new Date(now.getTime() + 60_000),
          absoluteExpiry: new Date(now.getTime() + 5 * DAY),
        },
      ]);

      const renewed = await service.renewEligibleTokens(now);

      expect(renewed).toBe(2);
      // A crash mid-run must not leave half the batch renewed.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there are no candidates', async () => {
      prisma.incidentAccessToken.findMany.mockResolvedValue([]);

      expect(await service.renewEligibleTokens(now)).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
