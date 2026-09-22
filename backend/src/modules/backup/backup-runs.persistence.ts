/**
 * The ONLY file in this module that touches `prisma` directly — mocked wholesale
 * (`jest.mock('./backup-runs.persistence')`) by `backup-runner.spec.ts`, the same "runner logic
 * tested without a real database" split every other sweep runner in this codebase already holds
 * (e.g. `documents/conformity/conformity-sweep-runner.spec.ts` mocking
 * `authority-events.persistence.ts` wholesale).
 */
import prisma from '@/prisma/prisma.service';

import { BackupRunStatus } from '../../../prisma/generated/prisma/client';

export interface BackupRunError {
  key: string;
  message: string;
}

/** Creates the RUNNING row a sweep starts as — `backup-runner.ts` calls this FIRST, before touching
 *  any source, so `GET /api/backup/status` has something to show even for a run still in flight
 *  (this model's own header on `schema.prisma`). */
export async function startBackupRun(): Promise<string> {
  const run = await prisma.backupRun.create({ data: {} });
  return run.id;
}

export interface FinishBackupRunInput {
  status: BackupRunStatus;
  filesScanned: number;
  filesUploaded: number;
  filesSkipped: number;
  filesFailed: number;
  bytesUploaded: bigint;
  errors: BackupRunError[];
}

export async function finishBackupRun(id: string, input: FinishBackupRunInput): Promise<void> {
  await prisma.backupRun.update({
    where: { id },
    data: {
      status: input.status,
      filesScanned: input.filesScanned,
      filesUploaded: input.filesUploaded,
      filesSkipped: input.filesSkipped,
      filesFailed: input.filesFailed,
      bytesUploaded: input.bytesUploaded,
      errors: input.errors as unknown as object,
      finishedAt: new Date(),
    },
  });
}

export interface BackupRunSummary {
  id: string;
  status: BackupRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  filesScanned: number;
  filesUploaded: number;
  filesSkipped: number;
  filesFailed: number;
  /** Stringified — a Prisma `BigInt` column does not survive `JSON.stringify` (Nest's own response
   *  serializer would throw "Do not know how to serialize a BigInt") — converted here, once, at the
   *  read boundary, rather than trusted to every future caller. */
  bytesUploaded: string;
  errors: BackupRunError[];
}

/** `null` when no sweep has ever run yet (a fresh instance, or the backup module was only just
 *  enabled) — `GET /api/backup/status` reports that as a fact, never a 404/500. */
export async function getLatestBackupRun(): Promise<BackupRunSummary | null> {
  const run = await prisma.backupRun.findFirst({ orderBy: { startedAt: 'desc' } });
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    filesScanned: run.filesScanned,
    filesUploaded: run.filesUploaded,
    filesSkipped: run.filesSkipped,
    filesFailed: run.filesFailed,
    bytesUploaded: run.bytesUploaded.toString(),
    errors: (run.errors as unknown as BackupRunError[] | null) ?? [],
  };
}
