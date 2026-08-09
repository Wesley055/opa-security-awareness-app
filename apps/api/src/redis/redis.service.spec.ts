import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Redis is optional infrastructure (ADR-016 D5, readiness-policy.ts): nothing
 * in the application uses it today, and getClient() has no callers.
 *
 * These tests pin the SUPPORTED no-Redis configuration. Before 8 August 2026
 * onModuleInit threw when REDIS_URL was absent, and the env schema made that
 * unreachable - so removing the setting from App Service failed config
 * validation and took production down instead.
 */
describe('RedisService without REDIS_URL', () => {
  const savedUrl = process.env.REDIS_URL;
  let service: RedisService;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.REDIS_URL;
    service = new RedisService();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await service.onModuleDestroy();
    // Restore rather than leave deleted: jest workers share process.env
    // across every test in a file.
    if (savedUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = savedUrl;
    }
  });

  it('starts without throwing', async () => {
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('logs the deployment marker exactly once', async () => {
    await service.onModuleInit();

    const marker = logSpy.mock.calls.filter((call) =>
      String(call[0]).includes('Redis not configured'),
    );

    expect(marker).toHaveLength(1);
  });

  it('reports unhealthy, so readiness reports optional-down', async () => {
    await service.onModuleInit();
    await expect(service.isHealthy()).resolves.toBe(false);
  });

  it('getClient() throws a message naming configuration', async () => {
    await service.onModuleInit();
    expect(() => service.getClient()).toThrow(/not configured/i);
  });

  it('onModuleDestroy is safe with no client', async () => {
    await service.onModuleInit();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
