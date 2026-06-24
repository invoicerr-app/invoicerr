import { PrismaService } from '@/prisma/prisma.service';
import { PollJob, PollJobStore } from '../lifecycle/drivers/poll-job';
import { TimerJob, TimerJobStore } from '../lifecycle/drivers/timer-job';
import { pollJobToRow, rowToPollJob, timerJobToRow, rowToTimerJob } from './mappers';

const POLL_STATUSES: string[] = ['PENDING', 'ARMED'];
const TIMER_STATUSES: string[] = ['ARMED'];

export class PrismaPollJobStore implements PollJobStore {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(job: PollJob): Promise<PollJob> {
    const data = pollJobToRow(job, 'POLL');
    await this.prisma.scheduledJob.create({ data: data as any });
    return job;
  }

  async save(job: PollJob): Promise<PollJob> {
    await this.prisma.scheduledJob.update({ where: { id: job.id }, data: job as any });
    return job;
  }

  async get(id: string): Promise<PollJob | null> {
    const row = await this.prisma.scheduledJob.findUnique({ where: { id } });
    if (!row || row.kind !== 'POLL') return null;
    return rowToPollJob(row as any);
  }

  async due(now: Date): Promise<PollJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'POLL', status: { in: POLL_STATUSES as any }, nextRunAt: { lte: now } },
    });
    return rows.map((r) => rowToPollJob(r as any));
  }

  async forDocument(documentId: string): Promise<PollJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'POLL', documentId },
    });
    return rows.map((r) => rowToPollJob(r as any));
  }

  async cancelForDocument(documentId: string): Promise<void> {
    await this.prisma.scheduledJob.updateMany({
      where: { kind: 'POLL', documentId, status: { in: POLL_STATUSES as any } },
      data: { status: 'CANCELLED' as any },
    });
  }
}

export class PrismaTimerJobStore implements TimerJobStore {
  constructor(private readonly prisma: PrismaService) {}

  async arm(job: TimerJob): Promise<TimerJob> {
    const data = timerJobToRow(job, 'TIMER');
    await this.prisma.scheduledJob.create({ data: data as any });
    return job;
  }

  async save(job: TimerJob): Promise<TimerJob> {
    await this.prisma.scheduledJob.update({ where: { id: job.id }, data: job as any });
    return job;
  }

  async get(id: string): Promise<TimerJob | null> {
    const row = await this.prisma.scheduledJob.findUnique({ where: { id } });
    if (!row || row.kind !== 'TIMER') return null;
    return rowToTimerJob(row as any);
  }

  async due(now: Date): Promise<TimerJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'TIMER', status: { in: TIMER_STATUSES as any }, fireAt: { lte: now } },
    });
    return rows.map((r) => rowToTimerJob(r as any));
  }

  async forDocument(documentId: string): Promise<TimerJob[]> {
    const rows = await this.prisma.scheduledJob.findMany({
      where: { kind: 'TIMER', documentId },
    });
    return rows.map((r) => rowToTimerJob(r as any));
  }

  async cancelForDocument(documentId: string): Promise<void> {
    await this.prisma.scheduledJob.updateMany({
      where: { kind: 'TIMER', documentId, status: { in: TIMER_STATUSES as any } },
      data: { status: 'CANCELLED' as any },
    });
  }
}
