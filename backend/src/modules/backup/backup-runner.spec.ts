/**
 * `BackupRunner` in isolation — persistence (`backup-runs.persistence.ts`) and both source walkers
 * are mocked wholesale, the same `vi.mock('./x')` discipline every other sweep runner in this
 * codebase already holds for its own persistence module (e.g.
 * `documents/conformity/conformity-sweep-runner.spec.ts`). `BackupDestination` is a hand-built fake,
 * never the real S3-backed class — this file's whole point is a runner that never reaches a real
 * network call; dedicated coverage for the S3 wiring itself lives in `backup-destination.spec.ts`.
 */

import { vi, type Mock } from 'vitest';

vi.mock('./backup-runs.persistence');
vi.mock('./sources/archive-source');
vi.mock('./sources/inbound-source');

import { BackupDestination } from './backup-destination';
import { finishBackupRun, startBackupRun } from './backup-runs.persistence';
import { BackupRunner } from './backup-runner';
import { listArchiveBackupSources } from './sources/archive-source';
import { BackupSourceFile } from './sources/backup-source';
import { listInboundBackupSources } from './sources/inbound-source';

const mockStartBackupRun = startBackupRun as Mock;
const mockFinishBackupRun = finishBackupRun as Mock;
const mockListArchive = listArchiveBackupSources as Mock;
const mockListInbound = listInboundBackupSources as Mock;

function fakeFile(key: string, size: number, bytes: string): BackupSourceFile {
  return { key, size, read: async () => Buffer.from(bytes) };
}

function fakeDestination(existingSizes: Record<string, number | null>): {
  destination: BackupDestination;
  uploaded: Array<{ key: string; bytes: Buffer }>;
} {
  const uploaded: Array<{ key: string; bytes: Buffer }> = [];
  const destination = {
    existingSize: vi.fn(async (key: string) => existingSizes[key] ?? null),
    upload: vi.fn(async (key: string, bytes: Buffer) => {
      uploaded.push({ key, bytes });
    }),
  } as unknown as BackupDestination;
  return { destination, uploaded };
}

describe('backup/BackupRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartBackupRun.mockResolvedValue('run-1');
    mockFinishBackupRun.mockResolvedValue(undefined);
    mockListArchive.mockResolvedValue([]);
    mockListInbound.mockReturnValue([]);
  });

  it('uploads a new file, skips one already present at the same size, and reports both', async () => {
    mockListArchive.mockResolvedValue([fakeFile('archive/a', 5, 'aaaaa')]);
    mockListInbound.mockReturnValue([fakeFile('inbound/b', 3, 'bbb')]);
    const { destination, uploaded } = fakeDestination({ 'inbound/b': 3 /* already there, same size */ });

    const result = await new BackupRunner(destination).runSweep();

    expect(result.status).toBe('COMPLETED');
    expect(result.filesScanned).toBe(2);
    expect(result.filesUploaded).toBe(1);
    expect(result.filesSkipped).toBe(1);
    expect(result.filesFailed).toBe(0);
    expect(result.bytesUploaded).toBe(5n);
    expect(uploaded).toEqual([{ key: 'archive/a', bytes: Buffer.from('aaaaa') }]);
  });

  it('re-uploads when the destination size differs from the source (defensive drift check)', async () => {
    mockListArchive.mockResolvedValue([fakeFile('archive/a', 5, 'aaaaa')]);
    const { destination, uploaded } = fakeDestination({ 'archive/a': 2 /* stale/truncated object */ });

    const result = await new BackupRunner(destination).runSweep();

    expect(result.filesUploaded).toBe(1);
    expect(result.filesSkipped).toBe(0);
    expect(uploaded).toEqual([{ key: 'archive/a', bytes: Buffer.from('aaaaa') }]);
  });

  it('a single failing file is recorded in errors/filesFailed and never aborts the run', async () => {
    mockListArchive.mockResolvedValue([fakeFile('archive/broken', 1, 'x'), fakeFile('archive/ok', 1, 'y')]);
    const destination = {
      existingSize: vi.fn().mockRejectedValueOnce(new Error('S3 hiccup')).mockResolvedValueOnce(null),
      upload: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackupDestination;

    const result = await new BackupRunner(destination).runSweep();

    expect(result.status).toBe('COMPLETED');
    expect(result.filesScanned).toBe(2);
    expect(result.filesUploaded).toBe(1);
    expect(result.filesFailed).toBe(1);
    expect(result.errors).toEqual([{ key: 'archive/broken', message: 'S3 hiccup' }]);
  });

  it('persists the run via startBackupRun/finishBackupRun, in that order', async () => {
    mockListArchive.mockResolvedValue([fakeFile('archive/a', 1, 'x')]);
    const { destination } = fakeDestination({});

    await new BackupRunner(destination).runSweep();

    expect(mockStartBackupRun).toHaveBeenCalledTimes(1);
    expect(mockFinishBackupRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'COMPLETED', filesUploaded: 1 }),
    );
  });

  it('reports FAILED, never aborts silently, when source enumeration itself throws', async () => {
    mockListArchive.mockRejectedValue(new Error('ARCHIVE_S3_ACCESS_KEY_ID is not set'));
    const { destination } = fakeDestination({});

    const result = await new BackupRunner(destination).runSweep();

    expect(result.status).toBe('FAILED');
    expect(result.filesFailed).toBe(1);
    expect(result.errors[0].message).toContain('ARCHIVE_S3_ACCESS_KEY_ID');
    expect(mockFinishBackupRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'FAILED' }));
  });
});
