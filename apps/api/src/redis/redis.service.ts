import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      // Env validation (Zod) should catch this, but fail loudly if it slips through.
      throw new Error('REDIS_URL is not set');
    }

    this.client = new Redis(url, {
      // Don't let a slow/unavailable Redis hang app startup forever.
      // ioredis retries connections automatically with backoff.
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        // Backoff capped at 5s between attempts.
        return Math.min(times * 500, 5000);
      },
      lazyConnect: false,
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connection established');
    });
    this.client.on('ready', () => {
      this.logger.log('Redis client ready');
    });
    this.client.on('error', (err: Error) => {
      // Log but don't crash - readiness check will report Redis as down.
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.client.on('close', () => {
      this.logger.warn('Redis connection closed');
    });
    this.client.on('reconnecting', () => {
      this.logger.warn('Redis reconnecting...');
    });

    // Verify connectivity on startup with a PING.
    try {
      const pong = await this.client.ping();
      this.logger.log(`Redis PING -> ${pong}`);
    } catch (err) {
      // Startup should not hard-fail just because Redis is down at boot;
      // the app can still serve the synchronous path, and readiness will
      // report Redis as unavailable. Log it clearly.
      this.logger.error(
        `Redis PING failed on startup: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger.log('Redis connection closed gracefully');
      } catch {
        this.client.disconnect();
      }
    }
  }

  // Expose the client for future use (dispatch/outbox pass).
  // Guarded so accidental access before init throws a clear error.
  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client has not been initialized.');
    }
    return this.client;
  }

  // Lightweight health check for /health/ready.
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
