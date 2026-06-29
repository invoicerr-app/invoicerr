import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';

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
  ) {}

  /**
   * On boot: reconcile every non-terminal document's status. After a downtime, the authority/PDP may
   * have resolved (or pushed, and we missed the webhook) statuses while we were offline — re-poll them
   * now instead of waiting for the next due tick. Fire-and-forget so it never blocks app readiness.
   */
  onApplicationBootstrap(): void {
    void this.reconcile('boot');
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
