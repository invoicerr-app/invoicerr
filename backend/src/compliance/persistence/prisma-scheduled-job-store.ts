import { PrismaService } from '@/prisma/prisma.service';
import { ScheduledJobStatus } from '../../../prisma/generated/prisma/client';
import { PollJob, PollJobStore } from '../lifecycle/drivers/poll-job';
import { TimerJob, TimerJobStore } from '../lifecycle/drivers/timer-job';
import {
  pollJobToRow,
  pollJobToUpdateRow,
  rowToPollJob,
  timerJobToRow,
  timerJobToUpdateRow,
  rowToTimerJob,
} from './mappers';

const POLL_STATUSES: ScheduledJobStatus[] = ['PENDING', 'ARMED'];
const TIMER_STATUSES: ScheduledJobStatus[] = ['ARMED'];

export class PrismaPollJobStore implements PollJobStore {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(job: PollJob): Promise<PollJob> {
    const data = pollJobToRow(job, 'POLL');
    await this.prisma.scheduledJob.create({ data });
    return job;
  }

  async save(job: PollJob): Promise<PollJob> {
    await this.prisma.scheduledJob.update({ where: { id: job.id }, data: pollJobToUpdateRow(job) });
    return job;
  }

  async get(id: string): Promise<PollJob | null> {
    const row = await this.prisma.scheduledJob.findUnique({ where: { id } });
    if (!row || row.kind !== 'POLL') return null;
    return rowToPollJob(row);
  }

  async pending(): Promise<PollJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'POLL', status: { in: POLL_STATUSES } },
    });
    return rows.map((r) => rowToPollJob(r));
  }

  async due(now: Date): Promise<PollJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'POLL', status: { in: POLL_STATUSES }, nextRunAt: { lte: now } },
    });
    return rows.map((r) => rowToPollJob(r));
  }

  async forDocument(documentId: string): Promise<PollJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'POLL', documentId },
    });
    return rows.map((r) => rowToPollJob(r));
  }

  async cancelForDocument(documentId: string): Promise<void> {
    await this.prisma.scheduledJob.updateMany({
      where: { kind: 'POLL', documentId, status: { in: POLL_STATUSES } },
      data: { status: 'CANCELLED' },
    });
  }
}

export class PrismaTimerJobStore implements TimerJobStore {
  constructor(private readonly prisma: PrismaService) {}

  async arm(job: TimerJob): Promise<TimerJob> {
    const data = timerJobToRow(job, 'TIMER');
    await this.prisma.scheduledJob.create({ data });
    return job;
  }

  async save(job: TimerJob): Promise<TimerJob> {
    await this.prisma.scheduledJob.update({ where: { id: job.id }, data: timerJobToUpdateRow(job) });
    return job;
  }

  async get(id: string): Promise<TimerJob | null> {
    const row = await this.prisma.scheduledJob.findUnique({ where: { id } });
    if (!row || row.kind !== 'TIMER') return null;
    return rowToTimerJob(row);
  }

  async due(now: Date): Promise<TimerJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'TIMER', status: { in: TIMER_STATUSES }, fireAt: { lte: now } },
    });
    return rows.map((r) => rowToTimerJob(r));
  }

  async forDocument(documentId: string): Promise<TimerJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'TIMER', documentId },
    });
    return rows.map((r) => rowToTimerJob(r));
  }

  async cancelForDocument(documentId: string): Promise<void> {
    await this.prisma.scheduledJob.updateMany({
      where: { kind: 'TIMER', documentId, status: { in: TIMER_STATUSES } },
      data: { status: 'CANCELLED' },
    });
  }
}
