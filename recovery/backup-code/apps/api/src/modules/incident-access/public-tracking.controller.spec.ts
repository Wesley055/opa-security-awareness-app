import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PublicTrackingController } from './public-tracking.controller';
import { PublicTrackingService } from './public-tracking.service';

describe('PublicTrackingController', () => {
  const tracking = { getSnapshot: jest.fn() };

  let app: INestApplication;

  const openSnapshot = {
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
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicTrackingController],
      providers: [{ provide: PublicTrackingService, useValue: tracking }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('status codes', () => {
    it('returns 200 for a valid token', async () => {
      tracking.getSnapshot.mockResolvedValue(openSnapshot);

      const response = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(openSnapshot);
    });

    it('returns 200 for a closed incident', async () => {
      // Closure is a normal, expected outcome - not an error.
      tracking.getSnapshot.mockResolvedValue({
        state: 'INCIDENT_CLOSED',
        incident: {
          personName: 'Charles Haynes',
          status: 'RESOLVED',
          triggeredAt: '2026-07-24T14:00:58.320Z',
          resolvedAt: '2026-07-24T15:00:00.000Z',
        },
      });

      const response = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('INCIDENT_CLOSED');
    });

    it('returns 410 for an expired link', async () => {
      tracking.getSnapshot.mockResolvedValue({
        state: 'EXPIRED',
        incident: null,
      });

      const response = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      // 410 Gone: this capability existed and no longer does.
      expect(response.status).toBe(410);
      expect(response.body.state).toBe('EXPIRED');
    });

    it('returns 410 for a revoked link', async () => {
      tracking.getSnapshot.mockResolvedValue({
        state: 'REVOKED',
        incident: null,
      });

      const response = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      expect(response.status).toBe(410);
      expect(response.body.state).toBe('REVOKED');
    });

    it('returns 404 for an unknown token', async () => {
      tracking.getSnapshot.mockResolvedValue({
        state: 'NOT_FOUND',
        incident: null,
      });

      const response = await request(app.getHttpServer()).get(
        '/public/tracking/definitelynotarealtoken',
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ state: 'NOT_FOUND', incident: null });
    });

    it('keeps EXPIRED and REVOKED distinguishable despite sharing a status code', async () => {
      // Both are 410, but a family member needs to know whether the incident
      // may still be active - so the body must still tell them apart.
      tracking.getSnapshot.mockResolvedValueOnce({
        state: 'EXPIRED',
        incident: null,
      });
      const expired = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      tracking.getSnapshot.mockResolvedValueOnce({
        state: 'REVOKED',
        incident: null,
      });
      const revoked = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      expect(expired.status).toBe(revoked.status);
      expect(expired.body.state).not.toBe(revoked.body.state);
    });
  });

  describe('privacy headers', () => {
    it.each([
      ['VALID', openSnapshot],
      [
        'INCIDENT_CLOSED',
        {
          state: 'INCIDENT_CLOSED',
          incident: {
            personName: 'Charles Haynes',
            status: 'RESOLVED',
            triggeredAt: '2026-07-24T14:00:58.320Z',
            resolvedAt: '2026-07-24T15:00:00.000Z',
          },
        },
      ],
      ['EXPIRED', { state: 'EXPIRED', incident: null }],
      ['REVOKED', { state: 'REVOKED', incident: null }],
      ['NOT_FOUND', { state: 'NOT_FOUND', incident: null }],
    ])('sets all privacy headers on %s responses', async (_label, result) => {
      tracking.getSnapshot.mockResolvedValue(result);

      const response = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      // A shared cache must never hold one person's emergency.
      expect(response.headers['cache-control']).toBe('no-store, private');
      // Without this, following any outbound link from the tracking page
      // would leak the token to a third party in the Referer header.
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      // A link pasted into a public forum must not be indexed.
      expect(response.headers['x-robots-tag']).toBe(
        'noindex, nofollow, noarchive',
      );
    });
  });

  describe('token handling', () => {
    it('passes the token to the service unchanged', async () => {
      tracking.getSnapshot.mockResolvedValue(openSnapshot);

      await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      expect(tracking.getSnapshot).toHaveBeenCalledTimes(1);
      expect(tracking.getSnapshot).toHaveBeenCalledWith(
        'uPh7xweQxdkhxIzXZqKH0w',
      );
    });

    it('requires no authentication', async () => {
      // Capability links deliberately bypass authentication: the bearer token
      // IS the credential. A family member receives this by SMS during an
      // emergency and must be able to open it without an account.
      tracking.getSnapshot.mockResolvedValue(openSnapshot);

      const response = await request(app.getHttpServer()).get(
        '/public/tracking/uPh7xweQxdkhxIzXZqKH0w',
      );

      expect(response.status).toBe(200);
    });
  });
});
