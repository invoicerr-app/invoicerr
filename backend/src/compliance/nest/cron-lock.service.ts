/**
 * CronLockService — distributed lease lock for multi-instance deployments (§13).
 *
 * Each cron tick calls tryAcquire() before running. If another process holds the
 * lock (lockedUntil > NOW()), the call returns false and the tick is skipped.
 * Crashed instances auto-expire when their TTL lapses.
 *
 * Implementation: atomic Postgres conditional upsert via $queryRaw so the
 * "check expiry → write" is a single statement with no TOCTOU window.
 *
 * The in-process guard in ComplianceCron is kept as the first line of defense
 * (cheaper than a DB round-trip). This service is the second guard for
 * cross-process safety.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import * as os from 'os';

/** Stable instance identity within this process lifetime. */
export const CRON_OWNER = `${os.hostname()}:${process.pid}`;

@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempt to acquire the named cron lock for `ttlMs` milliseconds.
   *
   * Returns `true` if this instance now holds the lock, `false` if another
   * instance currently holds an unexpired lease.
   *
   * The conditional upsert is atomic: it sets the row only when the existing
   * `lockedUntil` is in the past (or the row doesn't exist yet).
   */
  async tryAcquire(name: string, ttlMs: number): Promise<boolean> {
    const lockedUntil = new Date(Date.now() + ttlMs);
    try {
      // Single atomic statement: insert or update ONLY IF lock is expired.
      // If the WHERE clause in DO UPDATE fails (lock is still valid), no row
      // is returned → acquired = false.
      const rows = await this.prisma.$queryRaw<{ name: string }[]>`
        INSERT INTO "CronLock" (name, "lockedUntil", owner, "updatedAt")
        VALUES (${name}, ${lockedUntil}, ${CRON_OWNER}, NOW())
        ON CONFLICT (name) DO UPDATE
          SET "lockedUntil" = EXCLUDED."lockedUntil",
              owner = EXCLUDED.owner,
              "updatedAt" = NOW()
          WHERE "CronLock"."lockedUntil" < NOW()
        RETURNING name
      `;
      const acquired = rows.length > 0;
      if (!acquired) {
        this.logger.debug(`cron lock "${name}" not acquired — held by another instance`);
      }
      return acquired;
    } catch (err) {
      // If the lock table is unavailable (e.g. migration not yet applied in a
      // rolling deploy), fail open so the cron still runs rather than halting.
      this.logger.warn(`cron lock "${name}" DB error (failing open): ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
  }

  /**
   * Release the lock (best-effort). Only releases if this instance is the owner,
   * so a concurrent re-acquisition by another instance is never revoked.
   */
  async release(name: string): Promise<void> {
    try {
      await this.prisma.cronLock.deleteMany({ where: { name, owner: CRON_OWNER } });
    } catch {
      // best-effort — expiry handles eventual cleanup
    }
  }

  /**
   * Renew the TTL mid-operation (call for long-running cron ticks to avoid
   * expiry during execution, e.g. the 12h reconcile).
   */
  async renew(name: string, ttlMs: number): Promise<void> {
    try {
      const lockedUntil = new Date(Date.now() + ttlMs);
      await this.prisma.cronLock.updateMany({
        where: { name, owner: CRON_OWNER },
        data: { lockedUntil },
      });
    } catch {
      // best-effort
    }
  }
}
