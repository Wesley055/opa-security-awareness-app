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
      // Running without Redis is a SUPPORTED configuration, not an
      // error. No client is created, isHealthy() reports false, and
      // readiness reports 'optional-down' while the overall verdict
      // stays 'ok' because only 'database' is required (ADR-016 D5).
      //
      // This line doubles as the DEPLOYMENT MARKER for the change
      // that made Redis optional: /health returns 200 on the old
      // build just as well as the new one, so it is not a signal.
      this.logger.log(
        'Redis not configured; running without optional Redis',
      );
      return;
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
  // Guarded so accidental access throws a clear error. Since Redis
  // became optional there are TWO causes for a null client - not
  // configured, or init has not run - and a future caller needs to
  // recognise the first as a deployment state rather than a bug.
  getClient(): Redis {
    if (!this.client) {
      throw new Error(
        'Redis client is unavailable because Redis is not configured or has not been initialized.',
      );
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
