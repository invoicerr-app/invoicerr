import { vi } from 'vitest';

import { Job } from 'bullmq';

import { BackupRunner, RunBackupSweepResult } from '../backup-runner';
import { toBackupSweepJobResult } from './backup-job-result';
import { BackupProcessor } from './backup.processor';

/**
 * The assertion that matters here is `JSON.stringify` on what `BackupProcessor.process` RESOLVES
 * WITH — the operation BullMQ itself performs on a job's return value before storing it — never
 * merely "the field is a number". Returning the runner's own `bigint`-carrying result made every
 * single sweep on a live cluster complete its work, persist a COMPLETED run, and THEN fail its
 * BullMQ job with "Do not know how to serialize a BigInt" until its retries were spent; nothing in
 * this repository noticed, because no test had ever serialised a processor's return value.
 */
function sweepResult(overrides: Partial<RunBackupSweepResult> = {}): RunBackupSweepResult {
  return {
    runId: 'run-1',
    status: 'COMPLETED',
    filesScanned: 3,
    filesUploaded: 2,
    filesSkipped: 1,
    filesFailed: 0,
    bytesUploaded: 4096n,
    errors: [],
    ...overrides,
  };
}

function processorReturning(result: RunBackupSweepResult): BackupProcessor {
  const runner = { runSweep: vi.fn().mockResolvedValue(result) } as unknown as BackupRunner;
  return new BackupProcessor(runner);
}

describe('backup/queue — the sweep job return value survives BullMQ serialisation', () => {
  it('JSON.stringify-s the processor result without throwing on a BigInt', async () => {
    const returned = await processorReturning(sweepResult()).process({ id: 'job-1' } as Job);

    expect(() => JSON.stringify(returned)).not.toThrow();
    expect(JSON.parse(JSON.stringify(returned))).toEqual({
      runId: 'run-1',
      status: 'COMPLETED',
      filesScanned: 3,
      filesUploaded: 2,
      filesSkipped: 1,
      filesFailed: 0,
      bytesUploaded: '4096',
      errors: [],
    });
  });

  it('serialises a FAILED run (bytesUploaded 0n) just as safely', async () => {
    const result = sweepResult({
      status: 'FAILED',
      filesScanned: 0,
      filesUploaded: 0,
      filesSkipped: 0,
      filesFailed: 1,
      bytesUploaded: 0n,
      errors: [{ key: '(enumerating backup sources)', message: 'boom' }],
    });

    const returned = await processorReturning(result).process({ id: 'job-2' } as Job);

    expect(() => JSON.stringify(returned)).not.toThrow();
    expect(JSON.parse(JSON.stringify(returned)).bytesUploaded).toBe('0');
  });

  it('keeps a byte count past Number.MAX_SAFE_INTEGER exact — the reason this is a string', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    const converted = toBackupSweepJobResult(sweepResult({ bytesUploaded: huge }));

    expect(converted.bytesUploaded).toBe('9007199254740992');
    // The casual `Number(...)` alternative cannot round-trip this value at all.
    expect(BigInt(converted.bytesUploaded)).toBe(huge);
  });
});
