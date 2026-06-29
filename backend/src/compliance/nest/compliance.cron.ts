import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';

/** Periodic reconciliation interval — default 12h, overridable via COMPLIANCE_RECONCILE_HOURS. */
const RECONCILE_INTERVAL_MS = (Number(process.env.COMPLIANCE_RECONCILE_HOURS) || 12) * 60 * 60 * 1000;

@Injectable()
export class ComplianceCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(ComplianceCron.name);
  private pollInFlight = false;
  private timerInFlight = false;
  private reconcileInFlight = false;

  constructor(
    private readonly pollScheduler: PollScheduler,
    private readonly timerScheduler: TimerScheduler,
    private readonly inboundRouter: InboundRouter,
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
    if (this.reconcileInFlight) {
      this.logger.warn(`reconcile (${trigger}) skipped: previous reconcile still running`);
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
    }
  }

  @Interval(30_000)
  async tickPolls(): Promise<void> {
    if (this.pollInFlight) {
      this.logger.warn('poll tick skipped: previous tick still running (interval too short or a poll is hanging)');
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
    }
  }

  @Interval(60_000)
  async tickTimers(): Promise<void> {
    if (this.timerInFlight) {
      this.logger.warn('timer tick skipped: previous tick still running');
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
    }
  }
}
