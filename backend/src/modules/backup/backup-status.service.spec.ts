jest.mock('./backup-runs.persistence');

import { Queue } from 'bullmq';

import { BackupStatusService } from './backup-status.service';
import { getLatestBackupRun, BackupRunSummary } from './backup-runs.persistence';
import { BACKUP_SWEEP_JOB_NAME } from './queue/backup-queue.constants';

const mockGetLatestBackupRun = getLatestBackupRun as jest.Mock;

const SAMPLE_RUN: BackupRunSummary = {
  id: 'run-1',
  status: 'COMPLETED',
  startedAt: new Date('2026-09-17T03:00:00Z'),
  finishedAt: new Date('2026-09-17T03:01:00Z'),
  filesScanned: 5,
  filesUploaded: 2,
  filesSkipped: 3,
  filesFailed: 1,
  bytesUploaded: '1024',
  errors: [
    {
      key: 'inbound/some-other-companyId/deadbeef.pdf',
      message: 'ENOENT: /var/data/some-other-companyId/deadbeef.pdf',
    },
  ],
};

describe('backup/BackupStatusService', () => {
  afterEach(() => jest.clearAllMocks());

  it('reports the last run and the next scheduled tick, filtered by job NAME', async () => {
    mockGetLatestBackupRun.mockResolvedValue(SAMPLE_RUN);
    const nextTick = Date.parse('2026-09-18T03:00:00Z');
    const queue = {
      getJobSchedulers: jest.fn().mockResolvedValue([
        { name: 'some-other-scheduler', next: 1 },
        { name: BACKUP_SWEEP_JOB_NAME, next: nextTick },
      ]),
    } as unknown as Queue;

    const status = await new BackupStatusService(queue).getStatus();

    expect(status.lastRun).toEqual({
      id: 'run-1',
      status: 'COMPLETED',
      startedAt: SAMPLE_RUN.startedAt,
      finishedAt: SAMPLE_RUN.finishedAt,
      filesScanned: 5,
      filesUploaded: 2,
      filesSkipped: 3,
      filesFailed: 1,
      bytesUploaded: '1024',
    });
    expect(status.nextRunAt).toBe(new Date(nextTick).toISOString());
    expect(status.schedule).toBe('0 3 * * *');
  });

  it(
    "never puts per-file error detail on the wire — another company's OWNER can reach this route " +
      "and a run's errors carry other tenants' companyId/documentId in their object keys",
    async () => {
      mockGetLatestBackupRun.mockResolvedValue(SAMPLE_RUN);
      const queue = { getJobSchedulers: jest.fn().mockResolvedValue([]) } as unknown as Queue;

      const status = await new BackupStatusService(queue).getStatus();

      expect(status.lastRun).not.toHaveProperty('errors');
      expect(JSON.stringify(status)).not.toContain('some-other-companyId');
    },
  );

  it('nextRunAt is null when the repeatable has not been registered yet', async () => {
    mockGetLatestBackupRun.mockResolvedValue(null);
    const queue = { getJobSchedulers: jest.fn().mockResolvedValue([]) } as unknown as Queue;

    const status = await new BackupStatusService(queue).getStatus();

    expect(status.lastRun).toBeNull();
    expect(status.nextRunAt).toBeNull();
  });
});
