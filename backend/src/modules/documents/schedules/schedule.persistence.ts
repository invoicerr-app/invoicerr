/**
 * Tenant-safe Prisma access for `DocumentSchedule` — the schedules' own twin of ../persistence.ts,
 * kept in this subdirectory rather than folded into that file for the same reason numbering/,
 * settlement/, and totals/ each keep their own: a schedule is a distinct concern from a document
 * instance, even though it always points at one.
 */
import { NotFoundException } from '@nestjs/common';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

export interface DocumentScheduleRecord {
  id: string;
  companyId: string;
  typeId: string;
  sourceDocumentId: string;
  actionId: string;
  cadence: string;
  anchorDay: number | null;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastError: string | null;
  enabled: boolean;
  params: unknown;
  createdAt: Date;
}

export interface CreateDocumentScheduleInput {
  companyId: string;
  typeId: string;
  sourceDocumentId: string;
  actionId: string;
  cadence: string;
  anchorDay: number | null;
  nextRunAt: Date;
  params?: Record<string, unknown> | null;
}

export async function createSchedule(input: CreateDocumentScheduleInput): Promise<DocumentScheduleRecord> {
  return prisma.documentSchedule.create({
    data: {
      companyId: input.companyId,
      typeId: input.typeId,
      sourceDocumentId: input.sourceDocumentId,
      actionId: input.actionId,
      cadence: input.cadence,
      anchorDay: input.anchorDay,
      nextRunAt: input.nextRunAt,
      params: (input.params ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Every schedule for the active company — optionally narrowed to one document type, the same
 *  `typeId?` convention ../persistence.ts's own `listDocuments` already holds. Newest first. */
export async function listSchedules(companyId: string, typeId?: string): Promise<DocumentScheduleRecord[]> {
  return prisma.documentSchedule.findMany({
    where: { companyId, ...(typeId ? { typeId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

/** 404s (never returns null) for the same reason ../persistence.ts's `findOwnedDocument` does: "this
 *  id doesn't exist" and "this id belongs to another company" must be indistinguishable from the
 *  outside. */
export async function findOwnedSchedule(companyId: string, id: string): Promise<DocumentScheduleRecord> {
  const schedule = await prisma.documentSchedule.findFirst({ where: { id, companyId } });
  if (!schedule) {
    throw new NotFoundException(`Schedule "${id}" not found.`);
  }
  return schedule;
}

export interface UpdateScheduleInput {
  enabled?: boolean;
}

/** The only two knobs the SCREEN itself ever writes: enable/disable. Cadence, source document, and
 *  action are fixed at creation — changing "which document, which action, which cadence" is
 *  indistinguishable from deleting this schedule and creating a new one, so this deliberately does
 *  not try to support it. */
export async function updateSchedule(
  companyId: string,
  id: string,
  input: UpdateScheduleInput,
): Promise<DocumentScheduleRecord> {
  await findOwnedSchedule(companyId, id);
  return prisma.documentSchedule.update({ where: { id }, data: input });
}

export async function deleteSchedule(companyId: string, id: string): Promise<void> {
  await findOwnedSchedule(companyId, id);
  await prisma.documentSchedule.delete({ where: { id } });
}

/**
 * Every schedule currently due — see schedule-sweep.ts's own `selectDueSchedules` for the pure
 * decision this query merely feeds (`enabled` and `nextRunAt <= now` are pushed down to Postgres via
 * the `[enabled, nextRunAt]` index rather than filtered in memory, but the LOGIC of "what counts as
 * due" lives in that pure function alone — this query is intentionally slightly broader-safe, never
 * narrower, than that function would allow, so a future rule added there is not silently bypassed by
 * an index-only assumption made here).
 */
export async function listDueSchedules(now: Date): Promise<DocumentScheduleRecord[]> {
  return prisma.documentSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
  });
}

/** The sweep's own advance — written as its OWN update, deliberately disjoint from
 *  `recordOccurrenceOutcome` below's fields (`lastError` only): see schedule-sweep-runner.ts's own
 *  header for why the two are independent writes, safe to interleave in either order. */
export async function advanceSchedule(
  id: string,
  input: { nextRunAt: Date; lastRunAt: Date },
): Promise<void> {
  await prisma.documentSchedule.update({
    where: { id },
    data: { nextRunAt: input.nextRunAt, lastRunAt: input.lastRunAt },
  });
}

/** The occurrence job's own outcome — `lastError: null` on success (clears a stale error from a
 *  PREVIOUS occurrence, the same "any forward progress clears the old error" convention
 *  ../persistence.ts's `upsertDocument` already holds for `DocumentInstance.lastActionError`), or the
 *  failure's message otherwise. Never touches `enabled` — see `DocumentSchedule.enabled`'s own schema
 *  comment on why a failure never disables a schedule by itself. Silently no-ops if the schedule was
 *  deleted between the occurrence being enqueued and it finishing — nothing left to record onto. */
export async function recordOccurrenceOutcome(id: string, lastError: string | null): Promise<void> {
  await prisma.documentSchedule.updateMany({ where: { id }, data: { lastError } });
}
