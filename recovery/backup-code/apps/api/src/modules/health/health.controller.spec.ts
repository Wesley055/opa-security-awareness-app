import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  const health = { getLiveness: jest.fn(), getReadiness: jest.fn() };

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
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

  // The readiness verdict is computed in the service and the HTTP status code
  // is chosen in the controller. The defect ADR-016 records lived in the join
  // between the two, so the mapping is asserted here against a stubbed
  // verdict, independently of how that verdict is reached.
  it('maps an ok verdict to HTTP 200', async () => {
    health.getReadiness.mockResolvedValue({
      status: 'ok',
      database: 'up',
      redis: 'optional-down',
      timestamp: '2026-08-01T21:35:57.985Z',
    });

    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.redis).toBe('optional-down');
  });

  it('maps a degraded verdict to HTTP 503', async () => {
    health.getReadiness.mockResolvedValue({
      status: 'degraded',
      database: 'down',
      redis: 'up',
      timestamp: '2026-08-01T21:35:57.985Z',
    });

    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
  });
});
