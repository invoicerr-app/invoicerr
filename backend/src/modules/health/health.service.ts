import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';

import { logPersistenceHealth, LogPersistenceSnapshot } from '@/logger/log-persistence-health';
import { getInstalledVersion } from '@/lib/app-version';
import { createIoredisClient } from '@/modules/documents/queue/redis.config';
import prisma from '@/prisma/prisma.service';

export const HEALTH_CHECK_TIMEOUT_MS = 2000;
// The endpoint is public and unthrottled, so a flood must not turn into one query and one PING each.
export const HEALTH_PROBE_REUSE_MS = 1000;

export interface HealthReport {
  /** 'degraded' once `Log` writes have failed `LOG_PERSIST_FAILURE_THRESHOLD` times in a row. */
  status: 'ok' | 'degraded';
  database: 'up';
  databaseLatencyMs: number;
  redis: 'up';
  redisLatencyMs: number;
  version: string;
  time: string;
  uptimeSeconds: number;
  /** Failed `Log` row writes, surfaced so a database that rejects them does not go unnoticed. */
  logPersistence: LogPersistenceSnapshot;
}

export type HealthFailure =
  | { status: 'error'; database: 'down' }
  | { status: 'error'; database: 'up'; redis: 'down' };

export type HealthResult = { healthy: true; report: HealthReport } | { healthy: false; body: HealthFailure };

type Probe = { up: true; latencyMs: number } | { up: false };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probe(run: () => Promise<unknown>): Promise<Probe> {
  const start = performance.now();
  try {
    await withTimeout(run(), HEALTH_CHECK_TIMEOUT_MS);
    return { up: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { up: false };
  }
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private redis?: Redis;
  private lastProbes?: { startedAt: number; result: Promise<[Probe, Probe]> };

  async check(): Promise<HealthResult> {
    const [database, redis] = await this.probes();
    if (!database.up) {
      return { healthy: false, body: { status: 'error', database: 'down' } };
    }
    if (!redis.up) {
      return { healthy: false, body: { status: 'error', database: 'up', redis: 'down' } };
    }
    const logPersistence = logPersistenceHealth.snapshot();
    return {
      healthy: true,
      report: {
        status: logPersistence.status,
        database: 'up',
        databaseLatencyMs: database.latencyMs,
        redis: 'up',
        redisLatencyMs: redis.latencyMs,
        version: getInstalledVersion().version,
        time: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        logPersistence,
      },
    };
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  private probes(): Promise<[Probe, Probe]> {
    const now = Date.now();
    if (!this.lastProbes || now - this.lastProbes.startedAt >= HEALTH_PROBE_REUSE_MS) {
      this.lastProbes = {
        startedAt: now,
        result: Promise.all([probe(() => prisma.$queryRaw`SELECT 1`), probe(() => this.pingRedis())]),
      };
    }
    return this.lastProbes.result;
  }

  private async pingRedis(): Promise<void> {
    if (!this.redis) {
      // No offline queue: while disconnected a PING fails at once instead of waiting for a reconnect.
      this.redis = createIoredisClient({
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: HEALTH_CHECK_TIMEOUT_MS,
      });
      this.redis.on('error', () => undefined);
    }
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      await this.redis.connect();
    }
    await this.redis.ping();
  }
}
