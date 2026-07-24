import { IncidentStatus } from '@prisma/client';
import { PublicTrackingService } from './public-tracking.service';

describe('PublicTrackingService', () => {
  const prisma = {
    incident: { findUnique: jest.fn() },
  };

  const accessTokens = {
    resolve: jest.fn(),
    recordAccess: jest.fn(),
  };

  let service: PublicTrackingService;

  const tokenRecord = { id: 'token-row-1', incidentId: 'incident-1' };

  const openIncident = {
    status: IncidentStatus.OPEN,
    latitude: 6.6018,
    longitude: 3.3515,
    createdAt: new Date('2026-07-24T14:00:58.320Z'),
    resolvedAt: null,
    lastTriggeredAt: new Date('2026-07-24T14:03:00.000Z'),
    retriggerCount: 0,
    user: { firstName: 'Charles', lastName: 'Haynes' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PublicTrackingService(prisma as never, accessTokens as never);
    accessTokens.recordAccess.mockResolvedValue(undefined);
  });

  describe('state precedence', () => {
    it('reports NOT_FOUND for an unknown token and never touches the database', async () => {
      accessTokens.resolve.mockResolvedValue({ status: 'NOT_FOUND' });

      const result = await service.getSnapshot('nope');

      expect(result).toEqual({ state: 'NOT_FOUND', incident: null });
      expect(prisma.incident.findUnique).not.toHaveBeenCalled();
    });

    it('reports REVOKED without disclosing anything about the incident', async () => {
      accessTokens.resolve.mockResolvedValue({
        status: 'REVOKED',
        token: tokenRecord,
      });

      const result = await service.getSnapshot('raw');

      // Revocation is an explicit access-control decision and outranks
      // everything else, so we do not even load the incident.
      expect(result).toEqual({ state: 'REVOKED', incident: null });
      expect(prisma.incident.findUnique).not.toHaveBeenCalled();
    });

    it('reports INCIDENT_CLOSED rather than EXPIRED when both apply', async () => {
      // This is the ordering that matters most: someone opening an old link
      // benefits far more from learning the emergency ended than from being
      // told only that their link lapsed.
      accessTokens.resolve.mockResolvedValue({
        status: 'EXPIRED',
        token: tokenRecord,
      });
      prisma.incident.findUnique.mockResolvedValue({
        ...openIncident,
        status: IncidentStatus.RESOLVED,
        resolvedAt: new Date('2026-07-24T15:00:00.000Z'),
      });

      const result = await service.getSnapshot('raw');

      expect(result.state).toBe('INCIDENT_CLOSED');
      // The combined case must also leave telemetry untouched.
      expect(accessTokens.recordAccess).not.toHaveBeenCalled();
    });

    it('reports EXPIRED when the incident is still open', async () => {
      accessTokens.resolve.mockResolvedValue({
        status: 'EXPIRED',
        token: tokenRecord,
      });
      prisma.incident.findUnique.mockResolvedValue(openIncident);

      const result = await service.getSnapshot('raw');

      // Must NOT say the incident ended: it may still be active, and telling
      // a family otherwise could convince them the emergency is over.
      expect(result).toEqual({ state: 'EXPIRED', incident: null });
    });

    it('reports VALID for an unexpired token on an open incident', async () => {
      accessTokens.resolve.mockResolvedValue({
        status: 'VALID',
        token: tokenRecord,
      });
      prisma.incident.findUnique.mockResolvedValue(openIncident);

      const result = await service.getSnapshot('raw');

      expect(result.state).toBe('VALID');
      // The incident must be looked up by the id on the resolved token -
      // never by the raw token, a user id, or anything else.
      expect(prisma.incident.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'incident-1' } }),
      );
    });
  });

  describe('access telemetry', () => {
    it('records access only for a VALID result', async () => {
      accessTokens.resolve.mockResolvedValue({
        status: 'VALID',
        token: tokenRecord,
      });
      prisma.incident.findUnique.mockResolvedValue(openIncident);

      await service.getSnapshot('raw');

      expect(accessTokens.recordAccess).toHaveBeenCalledWith('token-row-1');
    });

    it.each([
      ['NOT_FOUND', { status: 'NOT_FOUND' }, null],
      ['REVOKED', { status: 'REVOKED', token: tokenRecord }, null],
      ['EXPIRED', { status: 'EXPIRED', token: tokenRecord }, openIncident],
    ])(
      'does not record access for %s',
      async (_label, resolution, incident) => {
        accessTokens.resolve.mockResolvedValue(resolution);
        prisma.incident.findUnique.mockResolvedValue(incident);

        await service.getSnapshot('raw');

        // Expired, revoked and unknown links must not pollute the telemetry
        // used to spot an unusually widely shared link.
        expect(accessTokens.recordAccess).not.toHaveBeenCalled();
      },
    );

    it('does not record access for a closed incident', async () => {
      accessTokens.resolve.mockResolvedValue({
        status: 'VALID',
        token: tokenRecord,
      });
      prisma.incident.findUnique.mockResolvedValue({
        ...openIncident,
        status: IncidentStatus.RESOLVED,
        resolvedAt: new Date(),
      });

      await service.getSnapshot('raw');

      expect(accessTokens.recordAccess).not.toHaveBeenCalled();
    });
  });

  describe('snapshot contents', () => {
    beforeEach(() => {
      accessTokens.resolve.mockResolvedValue({
        status: 'VALID',
        token: tokenRecord,
      });
    });

    it('returns the fields a family member needs and nothing internal', async () => {
      prisma.incident.findUnique.mockResolvedValue(openIncident);

      const result = await service.getSnapshot('raw');

      expect(result).toEqual({
        state: 'VALID',
        incident: {
          personName: 'Charles Haynes',
          status: 'OPEN',
          triggeredAt: '2026-07-24T14:00:58.320Z',
          location: {
            latitude: 6.6018,
            longitude: 3.3515,
            capturedAt: '2026-07-24T14:00:58.320Z',
          },
          retriggerCount: 0,
          lastRetriggeredAt: null,
        },
      });
    });

    it('selects only the two name fields from the user, never the whole record', async () => {
      prisma.incident.findUnique.mockResolvedValue(openIncident);

      await service.getSnapshot('raw');

      const select = prisma.incident.findUnique.mock.calls[0][0].select;
      // Loading the full user would pull the password hash into memory on
      // every tracking request.
      expect(select.user).toEqual({
        select: { firstName: true, lastName: true },
      });
    });

    it('exposes lastRetriggeredAt only once the SOS has actually been retriggered', async () => {
      prisma.incident.findUnique.mockResolvedValue({
        ...openIncident,
        retriggerCount: 2,
      });

      const result = await service.getSnapshot('raw');

      expect(result).toMatchObject({
        incident: {
          retriggerCount: 2,
          lastRetriggeredAt: '2026-07-24T14:03:00.000Z',
        },
      });
    });

    it.each([
      [{ firstName: 'Charles', lastName: '' }, 'Charles'],
      [{ firstName: '', lastName: 'Haynes' }, 'Haynes'],
    ])(
      'uses whichever name part is available (%j)',
      async (user, expected) => {
        prisma.incident.findUnique.mockResolvedValue({
          ...openIncident,
          user,
        });

        const result = await service.getSnapshot('raw');

        expect(result).toMatchObject({ incident: { personName: expected } });
      },
    );

    it('falls back to a generic name rather than rendering an empty one', async () => {
      prisma.incident.findUnique.mockResolvedValue({
        ...openIncident,
        user: { firstName: '', lastName: '' },
      });

      const result = await service.getSnapshot('raw');

      expect(result).toMatchObject({
        incident: { personName: 'An OPA user' },
      });
    });

    it('discloses only that a closed incident ended', async () => {
      prisma.incident.findUnique.mockResolvedValue({
        ...openIncident,
        status: IncidentStatus.RESOLVED,
        resolvedAt: new Date('2026-07-24T15:00:00.000Z'),
      });

      const result = await service.getSnapshot('raw');

      expect(result).toEqual({
        state: 'INCIDENT_CLOSED',
        incident: {
          personName: 'Charles Haynes',
          status: 'RESOLVED',
          triggeredAt: '2026-07-24T14:00:58.320Z',
          resolvedAt: '2026-07-24T15:00:00.000Z',
        },
      });
      // No coordinates after closure: the closed response deliberately
      // reveals only that the incident ended.
      expect(result.incident).not.toHaveProperty('location');
    });
  });

  describe('data integrity', () => {
    it('reports NOT_FOUND if a token exists but its incident does not', async () => {
      accessTokens.resolve.mockResolvedValue({
        status: 'VALID',
        token: tokenRecord,
      });
      prisma.incident.findUnique.mockResolvedValue(null);

      const result = await service.getSnapshot('raw');

      // The foreign key makes this impossible under normal operation, so it
      // signals corruption rather than a missing link.
      expect(result).toEqual({ state: 'NOT_FOUND', incident: null });
      expect(accessTokens.recordAccess).not.toHaveBeenCalled();
    });

    it('logs the incident id for the corrupt case and never the raw token', async () => {
      accessTokens.resolve.mockResolvedValue({
        status: 'VALID',
        token: tokenRecord,
      });
      prisma.incident.findUnique.mockResolvedValue(null);

      const loggerError = jest
        .spyOn(
          (service as unknown as { logger: { error: (m: string) => void } })
            .logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await service.getSnapshot('secret-raw-token');

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('incident-1'),
      );
      // A raw token in the logs would be a working link to someone's
      // emergency.
      expect(loggerError).not.toHaveBeenCalledWith(
        expect.stringContaining('secret-raw-token'),
      );
    });
  });
});
