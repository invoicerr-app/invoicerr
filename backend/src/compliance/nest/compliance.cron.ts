import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';

@Injectable()
export class ComplianceCron {
  private readonly logger = new Logger(ComplianceCron.name);

  constructor(
    private readonly pollScheduler: PollScheduler,
    private readonly timerScheduler: TimerScheduler,
  ) {}

  @Interval(30_000)
  async tickPolls(): Promise<void> {
    const report = await this.pollScheduler.tick();
    if (report.due > 0) {
      this.logger.debug(`poll tick: ${report.polled} polled, ${report.resolved} resolved, ${report.rescheduled} rescheduled, ${report.expired} expired`);
    }
  }

  @Interval(60_000)
  async tickTimers(): Promise<void> {
    const report = await this.timerScheduler.tick();
    if (report.due > 0) {
      this.logger.debug(`timer tick: ${report.fired} fired`);
    }
  }
}
