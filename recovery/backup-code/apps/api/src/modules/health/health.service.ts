import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  dependencyState,
  readinessVerdict,
  type RedisReadinessState,
} from './readiness-policy';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  redis: RedisReadinessState;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  getLiveness(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessStatus> {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    const redisReachable = await this.redis.isHealthy();
    const redis = dependencyState('redis', redisReachable);

    return {
      status: readinessVerdict({
        database: database === 'up',
        redis: redisReachable,
      }),
      database,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
