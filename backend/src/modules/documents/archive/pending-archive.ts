/**
 * Prisma persistence for the archive RETRY JOURNAL (`PendingDocumentArchive`, see its own schema
 * comment) — plain functions scoped by company, never a class, the same discipline
 * `archive/persistence.ts` and `documents/persistence.ts` already hold.
 *
 * This is the one table in the archive path that is deliberately MUTABLE, unlike `DocumentArchive`
 * next to it: a row here is not a record of anything preserved, it is work still owed — bytes that
 * were delivered and not yet archived. It is written on failure, rewritten on every further failure,
 * and deleted (never marked) the moment a real archive exists for the document. Nothing here ever
 * writes `DocumentArchive`; that stays `persistence.ts#createDocumentArchive`'s sole job, which both
 * the send path and the retry sweep call.
 *
 * ## Why base64 and not a `Bytes` column
 *
 * An archive is an ORDERED SET of artifacts (`hashing.ts`'s framing: role, mime and length all
 * participate in `contentHash`), not one blob — a single `Bytes` column would need its own private
 * framing to hold several, which is a second serialization format for the exact data the archive
 * already frames. One JSON array of `{ role, mime, bytesBase64 }` keeps the set's shape explicit and
 * readable by an operator inspecting the row, at the cost of base64's ~33 % overhead on a payload
 * that only exists between a failure and the next successful retry.
 */
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { ArchivedArtifactInput } from './hashing';
import { nextArchiveRetryAt } from './archive-retry-sweep';

/** One artifact as it sits in the journal's `artifacts` column. */
interface PendingArtifactJson {
  role: string;
  mime: string;
  bytesBase64: string;
}

/** A due row, exactly as the sweep needs it — `artifacts` deliberately left RAW (`unknown`): decoding
 *  can fail on a hand-edited or truncated row, and that must be one row's own failure inside the
 *  sweep's per-row try/catch, never an exception thrown while merely listing what is due. */
export interface DuePendingArchive {
  id: string;
  companyId: string;
  documentId: string;
  artifacts: unknown;
  firstFailedAt: Date;
  attempts: number;
  lastError: string;
  escalatedAt: Date | null;
  /** The document's own number, joined here purely so the escalation names something a human can
   *  look for (`archive-retry-sweep.ts#buildEscalatedArchiveError`). Null for a type that never
   *  numbers, or a document that failed before numbering. */
  displayNumber: string | null;
  typeId: string;
}

export function encodePendingArtifacts(artifacts: ArchivedArtifactInput[]): Prisma.InputJsonValue {
  return artifacts.map((artifact) => ({
    role: artifact.role,
    mime: artifact.mime,
    bytesBase64: Buffer.from(artifact.bytes).toString('base64'),
  })) as unknown as Prisma.InputJsonValue;
}

/**
 * Rebuilds the exact `ArchivedArtifactInput[]` that was handed to archiving at send time — order
 * included, since it participates in `contentHash` (`hashing.ts`). Throws, rather than returning a
 * partial set, on anything it cannot read back: half an artifact set would archive successfully and
 * preserve the WRONG bytes under a hash that no longer matches what was delivered, which is worse
 * than staying in the journal with a named error.
 */
export function decodePendingArtifacts(value: unknown): ArchivedArtifactInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Pending archive row carries no readable artifact set.');
  }
  return value.map((entry, index) => {
    const artifact = entry as Partial<PendingArtifactJson> | null;
    if (
      !artifact ||
      typeof artifact.role !== 'string' ||
      typeof artifact.mime !== 'string' ||
      typeof artifact.bytesBase64 !== 'string'
    ) {
      throw new Error(`Pending archive artifact #${index} is malformed and cannot be archived.`);
    }
    return {
      role: artifact.role,
      mime: artifact.mime,
      bytes: new Uint8Array(Buffer.from(artifact.bytesBase64, 'base64')),
    };
  });
}

/**
 * Records that archiving these artifacts failed, and keeps the bytes so a later pass can try again.
 *
 * An UPSERT on `documentId`, never an insert: a second delivery of the same document (a
 * "send_failed" retry that delivers again) produces artifacts that REPLACE the pending ones — the
 * newer delivery is the one that has to be preserved — and restarts the schedule from scratch, since
 * nothing about the previous set's failure history says anything about this one's chances.
 */
export async function journalFailedArchive(input: {
  companyId: string;
  documentId: string;
  artifacts: ArchivedArtifactInput[];
  error: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const artifacts = encodePendingArtifacts(input.artifacts);
  const shared = {
    companyId: input.companyId,
    artifacts,
    firstFailedAt: now,
    // 1, not 0: the attempt that just failed at send time is an archiving attempt like any other, and
    // the escalation threshold counts every one of them.
    attempts: 1,
    lastError: input.error,
    nextAttemptAt: nextArchiveRetryAt(now, 1),
    escalatedAt: null,
  };
  await prisma.pendingDocumentArchive.upsert({
    where: { documentId: input.documentId },
    create: { documentId: input.documentId, ...shared },
    update: shared,
  });
}

/**
 * The rows the sweep may attempt now, oldest deadline first — see
 * `archive-retry-sweep.ts#readArchiveRetryBatchSize` for why this is capped while the
 * storage-erasure journal's own drain is not, and why ordering by the deadline is what makes the cap
 * starvation-free.
 */
export async function findDuePendingArchives(now: Date, take: number): Promise<DuePendingArchive[]> {
  const rows = await prisma.pendingDocumentArchive.findMany({
    where: { nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take,
    include: { document: { select: { displayNumber: true, typeId: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    documentId: row.documentId,
    artifacts: row.artifacts,
    firstFailedAt: row.firstFailedAt,
    attempts: row.attempts,
    lastError: row.lastError,
    escalatedAt: row.escalatedAt,
    displayNumber: row.document?.displayNumber ?? null,
    typeId: row.document?.typeId ?? '',
  }));
}

/** What one more failed attempt left behind — read by the sweep to decide whether THIS pass is the
 *  one that has to tell a human (see `archive-retry-sweep.ts`'s own header). */
export interface ArchiveRetryFailure {
  attempts: number;
  /** True only on the pass that actually crossed the threshold — a row already escalated reports
   *  false forever after, so the loud log and the rewritten `lastArchiveError` happen exactly once. */
  escalatedNow: boolean;
}

/**
 * Advances one row's own schedule after a failed retry: one more attempt, the new error, the next
 * deadline, and — the first time the threshold is crossed — the `escalatedAt` stamp. The row is
 * NEVER deleted here: see `PendingDocumentArchive`'s own schema comment on why abandoning it would
 * destroy the only remaining copy of the artifact.
 */
export async function recordArchiveRetryFailure(input: {
  id: string;
  attempts: number;
  alreadyEscalated: boolean;
  escalate: boolean;
  error: string;
  now: Date;
}): Promise<ArchiveRetryFailure> {
  const attempts = input.attempts + 1;
  const escalatedNow = input.escalate && !input.alreadyEscalated;
  await prisma.pendingDocumentArchive.update({
    where: { id: input.id },
    data: {
      attempts,
      lastError: input.error,
      nextAttemptAt: nextArchiveRetryAt(input.now, attempts),
      ...(escalatedNow ? { escalatedAt: input.now } : {}),
    },
  });
  return { attempts, escalatedNow };
}

/**
 * Drops whatever this document still owed the archive. `deleteMany` (not `delete`) so it is a no-op
 * rather than a throw for the overwhelmingly common case — a send that archived on the first attempt
 * and never journaled anything.
 */
export async function clearPendingArchive(documentId: string): Promise<void> {
  await prisma.pendingDocumentArchive.deleteMany({ where: { documentId } });
}

/** How many documents are still delivered-but-unarchived, across every company — the one number the
 *  sweep's own log line exists to put in front of an operator. */
export async function countPendingArchives(): Promise<number> {
  return prisma.pendingDocumentArchive.count();
}
