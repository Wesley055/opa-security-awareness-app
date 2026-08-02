import { HealthService } from './health.service';

describe('HealthService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const redis = { isHealthy: jest.fn() };

  const build = () => new HealthService(prisma as never, redis as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ADR-016 D2/D3: Redis is not in the required-dependency set, so it is
  // reported as unavailable without making the application unready. The
  // verdict covers required capabilities, not every reported dependency.
  it('reports optional-down and stays ok when Redis is unavailable', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    redis.isHealthy.mockResolvedValue(false);

    const result = await build().getReadiness();
    const redisState: string = result.redis;

    expect(result.database).toBe('up');
    expect(redisState).toBe('optional-down');
    expect(result.status).toBe('ok');
  });

  // The database IS required. Its absence must still fail readiness whatever
  // Redis is doing - otherwise widening the vocabulary would have weakened
  // the check rather than made it precise.
  it('reports degraded when the database is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    redis.isHealthy.mockResolvedValue(true);

    const result = await build().getReadiness();

    expect(result.database).toBe('down');
    expect(result.status).toBe('degraded');
  });

  // ADR-016 D5 graduation is tested in readiness-policy.spec.ts, where the
  // required set is an explicit production input rather than a runtime toggle.
  // The first test above pins HealthService's default production behaviour.
});
