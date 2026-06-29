import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { PrismaReportingStore } from '../reporting/prisma-reporting-store';
import { getPeriodKey, frequencyForKind } from '../reporting/period';
import { ReportingKind } from '../types';
import { CronLockService } from './cron-lock.service';

/** Periodic reconciliation interval — default 12h, overridable via COMPLIANCE_RECONCILE_HOURS. */
const RECONCILE_INTERVAL_MS = (Number(process.env.COMPLIANCE_RECONCILE_HOURS) || 12) * 60 * 60 * 1000;

/** TTL margins: lock TTL should be slightly less than the tick interval to allow re-acquisition
 *  after a clean release, but long enough to cover the entire tick duration. */
const LOCK_TTL = {
  polls: 25_000,        // 25 s  (tick is 30 s)
  timers: 55_000,       // 55 s  (tick is 60 s)
  reconcile: 11 * 60 * 60 * 1000, // 11 h (tick is 12 h)
  reportingClose: 23 * 60 * 60 * 1000, // 23 h (tick is daily)
};

@Injectable()
export class ComplianceCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(ComplianceCron.name);

  // In-process guards (first line of defence — cheaper than a DB round-trip)
  private pollInFlight = false;
  private timerInFlight = false;
  private reconcileInFlight = false;
  private reportingCloseInFlight = false;

  constructor(
    private readonly pollScheduler: PollScheduler,
    private readonly timerScheduler: TimerScheduler,
    private readonly inboundRouter: InboundRouter,
    private readonly reportingStore: PrismaReportingStore,
    private readonly cronLock: CronLockService,
  ) {}

  /**
   * On boot: two parallel recovery paths (both fire-and-forget to not block app readiness):
   *   1. reconcile() — re-poll all pending ASYNC_POLL jobs; fire elapsed timers. Catches
   *      pushes that arrived while we were offline and were missed by poll schedulers.
   *   2. replayInbound() — re-apply any InboundMessage that was stored in the DB (at-least-once
   *      delivery) but whose applySignal() call never completed (crash window).
   */
  onApplicationBootstrap(): void {
    void this.reconcile('boot');
    void this.replayInbound();
  }

  /**
   * Boot replay of un-applied inbound messages (COMPLIANCE_TODO §4).
   *
   * Loads all WAITING callback registrations and re-applies any stored messages for them.
   * Safe to call multiple times: the runtime returns NOOP for already-applied signals.
   */
  private async replayInbound(): Promise<void> {
    try {
      const { replayed, skipped } = await this.inboundRouter.replayUnapplied();
      if (replayed > 0 || skipped > 0) {
        this.logger.log(`boot inbound replay: ${replayed} replayed, ${skipped} skipped`);
      }
    } catch (err) {
      this.logger.error(`boot inbound replay failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Periodic safety net (default every 12h) against missed push/webhook notifications. */
  @Interval(RECONCILE_INTERVAL_MS)
  async tickReconcile(): Promise<void> {
    await this.reconcile('periodic');
  }

  private async reconcile(trigger: 'boot' | 'periodic'): Promise<void> {
    // In-process guard
    if (this.reconcileInFlight) {
      this.logger.warn(`reconcile (${trigger}) skipped: previous reconcile still running`);
      return;
    }
    // Distributed lock guard (§13)
    const lockName = 'compliance:reconcile';
    const acquired = await this.cronLock.tryAcquire(lockName, LOCK_TTL.reconcile);
    if (!acquired) {
      this.logger.debug(`reconcile (${trigger}) skipped: lock held by another instance`);
      return;
    }
    this.reconcileInFlight = true;
    try {
      // Fire elapsed timers first (deadlines that lapsed while offline), then re-poll all pending jobs.
      await this.timerScheduler.tick();
      const report = await this.pollScheduler.reconcile();
      if (report.polled > 0) {
        this.logger.log(
          `reconcile (${trigger}): ${report.polled} polled, ${report.resolved} resolved, ${report.rescheduled} rescheduled, ${report.expired} expired`,
        );
      }
    } catch (err) {
      this.logger.error(`reconcile (${trigger}) failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.reconcileInFlight = false;
      await this.cronLock.release(lockName);
    }
  }

  @Interval(30_000)
  async tickPolls(): Promise<void> {
    // In-process guard
    if (this.pollInFlight) {
      this.logger.warn('poll tick skipped: previous tick still running (interval too short or a poll is hanging)');
      return;
    }
    // Distributed lock guard (§13)
    const lockName = 'compliance:polls';
    const acquired = await this.cronLock.tryAcquire(lockName, LOCK_TTL.polls);
    if (!acquired) {
      this.logger.debug('poll tick skipped: lock held by another instance');
      return;
    }
    this.pollInFlight = true;
    try {
      const report = await this.pollScheduler.tick();
      if (report.due > 0) {
        this.logger.debug(`poll tick: ${report.polled} polled, ${report.resolved} resolved, ${report.rescheduled} rescheduled, ${report.expired} expired`);
      }
    } finally {
      this.pollInFlight = false;
      await this.cronLock.release(lockName);
    }
  }

  @Interval(60_000)
  async tickTimers(): Promise<void> {
    // In-process guard
    if (this.timerInFlight) {
      this.logger.warn('timer tick skipped: previous tick still running');
      return;
    }
    // Distributed lock guard (§13)
    const lockName = 'compliance:timers';
    const acquired = await this.cronLock.tryAcquire(lockName, LOCK_TTL.timers);
    if (!acquired) {
      this.logger.debug('timer tick skipped: lock held by another instance');
      return;
    }
    this.timerInFlight = true;
    try {
      const report = await this.timerScheduler.tick();
      if (report.due > 0) {
        this.logger.debug(`timer tick: ${report.fired} fired`);
      }
    } finally {
      this.timerInFlight = false;
      await this.cronLock.release(lockName);
    }
  }

  /**
   * §6 — Reporting period-close cron (daily at 02:00 UTC).
   *
   * For every PENDING ComplianceReport whose period has closed (i.e. periodKey is
   * strictly before the current period for that kind's frequency), attempt submission.
   * Submission is mocked (authority I/O is a per-kind TODO), but the idempotence
   * contract is real: after the first successful run the records are SUBMITTED and
   * a second run finds nothing PENDING for those periods (no-op).
   *
   * Guard: distributed lock (23 h TTL) prevents double-submission in a multi-instance deploy.
   */
  @Cron('0 2 * * *') // 02:00 UTC daily
  async tickReportingClose(): Promise<void> {
    // In-process guard
    if (this.reportingCloseInFlight) {
      this.logger.warn('reporting-close tick skipped: previous run still in progress');
      return;
    }
    // Distributed lock guard (§13)
    const lockName = 'compliance:reporting-close';
    const acquired = await this.cronLock.tryAcquire(lockName, LOCK_TTL.reportingClose);
    if (!acquired) {
      this.logger.debug('reporting-close tick skipped: lock held by another instance');
      return;
    }
    this.reportingCloseInFlight = true;
    const now = new Date();
    try {
      const pending = await this.reportingStore.findPendingForClosedPeriods(now);
      if (pending.length === 0) {
        this.logger.debug('reporting-close: no PENDING records for closed periods');
        return;
      }
      this.logger.log(`reporting-close: submitting ${pending.length} PENDING record(s) for closed periods`);

      let submitted = 0;
      let failed = 0;
      for (const record of pending) {
        try {
          // Mocked submission seam — real I/O is plugged in per-kind when authority creds are
          // available (same pattern as handlers.ts). The record transitions to SUBMITTED so a
          // second cron run is a no-op (idempotence via status check in findPendingForClosedPeriods).
          const mockRef = `mock-period-close:${record.kind}:${record.periodKey}:${record.id}`;
          await this.reportingStore.markSubmitted(record.id, mockRef, now);
          this.logger.debug(
            `reporting-close: [MOCK] submitted ${record.kind} period=${record.periodKey} company=${record.companyId ?? 'n/a'} ref=${mockRef}`,
          );
          submitted++;
        } catch (err) {
          failed++;
          this.logger.error(
            `reporting-close: failed to submit record ${record.id} (${record.kind}/${record.periodKey}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.logger.log(`reporting-close: done — ${submitted} submitted, ${failed} failed`);
    } catch (err) {
      this.logger.error(`reporting-close tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.reportingCloseInFlight = false;
      await this.cronLock.release(lockName);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers for period-close (exposed for testing)
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a periodKey is closed relative to `now`.
   * Monthly "2026-05" < current "2026-06" → closed.
   * Quarterly "2026-Q1" < current "2026-Q2" → closed.
   * Exposed as a static helper so unit tests can verify the logic independently.
   */
  static isPeriodClosed(kind: ReportingKind, periodKey: string, now: Date): boolean {
    const freq = frequencyForKind(kind);
    const currentPeriod = getPeriodKey(now, freq);
    return periodKey < currentPeriod;
  }
}
