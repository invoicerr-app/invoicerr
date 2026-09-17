/** Same `jest.mock('@/prisma/prisma.service', ...)` style every other thin persistence file in this
 *  codebase already uses (e.g. `documents/conformity/authority-events.persistence.spec.ts`). */
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    backupRun: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

import prisma from '@/prisma/prisma.service';

import { finishBackupRun, getLatestBackupRun, startBackupRun } from './backup-runs.persistence';

const mockedPrisma = prisma as unknown as {
  backupRun: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
};

describe('backup/backup-runs.persistence', () => {
  afterEach(() => jest.clearAllMocks());

  it('startBackupRun creates a bare (RUNNING-default) row and returns its id', async () => {
    mockedPrisma.backupRun.create.mockResolvedValue({ id: 'run-1' });

    await expect(startBackupRun()).resolves.toBe('run-1');
    expect(mockedPrisma.backupRun.create).toHaveBeenCalledWith({ data: {} });
  });

  it('finishBackupRun updates the row with every counter plus finishedAt', async () => {
    mockedPrisma.backupRun.update.mockResolvedValue({});

    await finishBackupRun('run-1', {
      status: 'COMPLETED',
      filesScanned: 3,
      filesUploaded: 2,
      filesSkipped: 1,
      filesFailed: 0,
      bytesUploaded: 123n,
      errors: [],
    });

    expect(mockedPrisma.backupRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        filesScanned: 3,
        filesUploaded: 2,
        filesSkipped: 1,
        filesFailed: 0,
        bytesUploaded: 123n,
        errors: [],
        finishedAt: expect.any(Date),
      }),
    });
  });

  describe('getLatestBackupRun', () => {
    it('returns null when no run has ever happened', async () => {
      mockedPrisma.backupRun.findFirst.mockResolvedValue(null);
      await expect(getLatestBackupRun()).resolves.toBeNull();
    });

    it('stringifies the BigInt bytesUploaded column (JSON.stringify cannot serialize a bigint)', async () => {
      mockedPrisma.backupRun.findFirst.mockResolvedValue({
        id: 'run-1',
        status: 'COMPLETED',
        startedAt: new Date('2026-01-01T03:00:00Z'),
        finishedAt: new Date('2026-01-01T03:05:00Z'),
        filesScanned: 10,
        filesUploaded: 8,
        filesSkipped: 2,
        filesFailed: 0,
        bytesUploaded: 9_000_000_000n,
        errors: [],
      });

      const result = await getLatestBackupRun();

      expect(result?.bytesUploaded).toBe('9000000000');
      expect(typeof result?.bytesUploaded).toBe('string');
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('defaults a null errors column to []', async () => {
      mockedPrisma.backupRun.findFirst.mockResolvedValue({
        id: 'run-1',
        status: 'FAILED',
        startedAt: new Date(),
        finishedAt: new Date(),
        filesScanned: 0,
        filesUploaded: 0,
        filesSkipped: 0,
        filesFailed: 1,
        bytesUploaded: 0n,
        errors: null,
      });

      const result = await getLatestBackupRun();
      expect(result?.errors).toEqual([]);
    });
  });
});
