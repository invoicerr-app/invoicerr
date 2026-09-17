import { Prisma } from '../../../prisma/generated/prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';

import { DocumentInstanceResult } from './actions/action-registry';

/**
 * Shared, tenant-safe persistence for document instances — used by action handlers (e.g.
 * quote-actions.ts) and by DocumentsService's read endpoints, so every one of them scopes by
 * companyId the same way instead of each action re-deriving it.
 */

/** 404s (rather than returning null) when `id` doesn't exist or belongs to another company/type —
 *  the two cases are indistinguishable from the outside, which is the point. */
export async function findOwnedDocument(
  companyId: string,
  typeId: string,
  id: string,
): Promise<DocumentInstanceResult> {
  const document = await prisma.documentInstance.findFirst({ where: { id, companyId, typeId } });
  if (!document) {
    throw new NotFoundException(`Document "${id}" not found for type "${typeId}".`);
  }
  return document;
}

/**
 * THE SHARED compare-and-swap PRIMITIVE behind every conditional write in this file —
 * `claimDocumentTransition` (the cross-process claim below) and `upsertDocument`/
 * `updateDocumentStatus`'s own optional `fromStatuses` guard both route through this ONE
 * `updateMany`, so "a write is conditional on the row's CURRENT status" stays one mechanism, never
 * two independently-evolving ones. Returns the row count Prisma reports (0 or 1) — never throws on
 * its own; every caller here decides what a `0` means for its own write.
 */
async function updateManyConditionally(
  companyId: string,
  typeId: string,
  id: string,
  fromStatuses: string[],
  data: Prisma.DocumentInstanceUpdateManyMutationInput,
  knownUpdatedAt?: Date,
): Promise<number> {
  const result = await prisma.documentInstance.updateMany({
    where: {
      id,
      companyId,
      typeId,
      status: { in: fromStatuses },
      ...(knownUpdatedAt !== undefined ? { updatedAt: knownUpdatedAt } : {}),
    },
    data,
  });
  return result.count;
}

/**
 * Creates a new instance, or updates an existing one owned by this company — used by any action
 * that persists the document's current field values under a given status (e.g. "save-draft", and the
 * first phase of the async "send" — actions/async-send.ts — moving "draft"/"send_failed" to
 * "sending"). Always resets `lastActionError` to null: any ordinary write like this one means the
 * record is moving forward again, and a stale failure message from a PREVIOUS attempt must never
 * linger next to it — see `DocumentInstance.lastActionError`'s own schema comment.
 *
 * `fromStatuses`, when given, makes this an atomic compare-and-swap (`updateManyConditionally` above)
 * instead of an unconditional `update` — the general form of the TOCTOU this module used to have on
 * EVERY write here: `runAction` (documents.service.ts) reads a document's status once, several
 * `await`s before any handler actually writes it, so two concurrent calls against the SAME record can
 * both pass that stale read and both reach this function. `undefined` (the default — every EXISTING
 * caller that has not been updated to pass its own expected status yet) preserves the exact previous,
 * unconditional behavior, byte for byte; a caller that DOES pass `fromStatuses` gets a named
 * `ConflictException` instead of a silently-won race the moment the row has already moved on.
 */
export async function upsertDocument(
  companyId: string,
  typeId: string,
  documentId: string | undefined,
  status: string,
  data: Record<string, unknown>,
  fromStatuses?: string[],
): Promise<DocumentInstanceResult> {
  const jsonData = data as Prisma.InputJsonValue;

  if (documentId) {
    await findOwnedDocument(companyId, typeId, documentId);
    if (fromStatuses === undefined) {
      return prisma.documentInstance.update({
        where: { id: documentId },
        data: { status, data: jsonData, lastActionError: null },
      });
    }
    const count = await updateManyConditionally(companyId, typeId, documentId, fromStatuses, {
      status,
      data: jsonData,
      lastActionError: null,
    });
    if (count === 0) {
      throw new ConflictException(
        `Document "${documentId}" is no longer in one of the expected statuses ` +
          `(${fromStatuses.join(', ')}) — another request already changed it concurrently.`,
      );
    }
    return findOwnedDocument(companyId, typeId, documentId);
  }

  return prisma.documentInstance.create({
    data: { companyId, typeId, status, data: jsonData, lastActionError: null },
  });
}

/**
 * A STATUS-ONLY write — `data` is left untouched, unlike `upsertDocument` above. Used by the second
 * phase of the async "send" (actions/async-send.ts, "sending" -> "sent": the record's field values
 * were already correct the moment "sending" was persisted, delivery changes nothing about them) and
 * by the terminal-failure path (queue/mark-send-failed.ts, "sending" -> "send_failed", which also
 * needs to record WHY). `lastActionError` defaults to null (the success case); pass the error message
 * explicitly for the failure case — never both silently disagree about which one this write means.
 *
 * `transportRef`, when passed, is what a transport handed back on successful delivery (see
 * `DocumentInstance.transportRef`'s own schema comment and `transports/transport-registry.ts`'s
 * `DocumentTransportResult.reference`) — `undefined` (the default) means "leave it untouched", not
 * "clear it": unlike `lastActionError`, there is nothing stale to reset on an ordinary write, since a
 * reference is only ever written once, on the write that records success. `channelProviderId` is the
 * SAME transport result's own `providerId` (`DocumentInstance.channelProviderId`'s own schema
 * comment) — written on the exact same call, for the exact same reason, so the two columns can never
 * disagree about which delivery they describe.
 *
 * `fromStatuses`, when given, is the SAME compare-and-swap `upsertDocument` above now supports (see
 * its own doc comment) — `undefined` (every caller not yet updated to pass its own expected status)
 * stays byte-for-byte the previous, unconditional `update`.
 */
export async function updateDocumentStatus(
  companyId: string,
  typeId: string,
  id: string,
  status: string,
  lastActionError: string | null = null,
  transportRef?: string,
  channelProviderId?: string,
  fromStatuses?: string[],
): Promise<DocumentInstanceResult> {
  await findOwnedDocument(companyId, typeId, id);
  const data: Prisma.DocumentInstanceUpdateManyMutationInput = {
    status,
    lastActionError,
    ...(transportRef !== undefined ? { transportRef } : {}),
    ...(channelProviderId !== undefined ? { channelProviderId } : {}),
  };
  if (fromStatuses === undefined) {
    return prisma.documentInstance.update({ where: { id }, data });
  }
  const count = await updateManyConditionally(companyId, typeId, id, fromStatuses, data);
  if (count === 0) {
    throw new ConflictException(
      `Document "${id}" is no longer in one of the expected statuses (${fromStatuses.join(', ')}) — ` +
        'another request already changed it concurrently.',
    );
  }
  return findOwnedDocument(companyId, typeId, id);
}

/**
 * Atomically claims `id` for a status transition ACROSS PROCESSES — the database-level guarantee
 * `actions/async-send.ts`'s own in-process `Set` cannot provide once the API and a BullMQ worker run
 * as separate processes (`WORKER_INLINE=false`) or either one is horizontally replicated (a Helm
 * chart scaling either deployment). No new column: `fromStatuses` names every status this claim may
 * legitimately start from, and `knownUpdatedAt` — the row's own `updatedAt` as the CALLER read it a
 * moment ago (e.g. `findOwnedDocument`'s own result) — is folded into the WHERE clause specifically so
 * this stays a genuine compare-and-swap even when `toStatus` equals the row's CURRENT status
 * (`async-send.ts`'s own phase-2 re-claim: "sending" reclaimed again, right before `deliver()`, with
 * no real status change at all). That inclusion is load-bearing, not decorative: a same-value
 * conditional write alone would never exclude a concurrent second claim — Postgres re-evaluates a
 * blocked UPDATE's own WHERE clause against the row's POST-COMMIT values once the first transaction's
 * lock releases (its "EvalPlanQual" step under READ COMMITTED), and a `status` that never actually
 * changed value still matches, so BOTH callers would see a non-zero count. `DocumentInstance.updatedAt`
 * carries `@updatedAt`, so Prisma bumps it on every `.updateMany()` that touches a row REGARDLESS of
 * whether `data` names it explicitly — which is exactly what makes the SECOND caller's now-stale
 * `knownUpdatedAt` fail to match once the first claim has already committed.
 *
 * Returns the row count actually claimed (0 or 1) — never throws for "someone else already claimed
 * it"; the caller decides what a `0` means (`async-send.ts` turns it into a named `ConflictException`
 * before ever calling `deliver()`), the same "this module reports the fact, the caller judges it"
 * posture the rest of it already holds.
 */
export async function claimDocumentTransition(
  companyId: string,
  typeId: string,
  id: string,
  fromStatuses: string[],
  knownUpdatedAt: Date,
  toStatus: string,
): Promise<number> {
  return updateManyConditionally(companyId, typeId, id, fromStatuses, { status: toStatus }, knownUpdatedAt);
}

/**
 * `take` defaults to 50 (the list screen's own page size budget) — a contribution that needs to
 * aggregate over more history (contributions/invoice-contributions.ts) passes a larger explicit
 * value rather than this function growing a second, uncapped code path. Still ordered by
 * `updatedAt`, same as ever: a contribution reading a large `take` is an honest "most recently
 * touched N documents" view, not a full, unbounded table scan.
 */
export async function listDocuments(
  companyId: string,
  typeId?: string,
  take = 50,
): Promise<DocumentInstanceResult[]> {
  return prisma.documentInstance.findMany({
    where: { companyId, ...(typeId ? { typeId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take,
  });
}

/**
 * The batched, EXACT-id companion to `findOwnedDocument` — every document among `ids` that belongs to
 * `companyId`, in ONE query, regardless of type or how far back `listDocuments`' own `take` cap would
 * otherwise reach. Added for accounting-export/accounting-export.service.ts:
 * a `DocumentPayment` row's `documentId` can, in principle, name any document (see
 * `DocumentPayment.documentId`'s own schema comment), so resolving "which invoice did this payment
 * settle" for a period-wide read needs an exact lookup, never a status/type-filtered, capped list. An
 * id absent from this company (foreign, deleted, or simply not among `ids`) is silently absent from
 * the result — never a throw, unlike `findOwnedDocument`: a caller resolving MANY ids at once treats a
 * stale one as "not found", not as a reason to abort the whole batch.
 */
export async function findOwnedDocumentsByIds(
  companyId: string,
  ids: readonly string[],
): Promise<DocumentInstanceResult[]> {
  if (ids.length === 0) return [];
  return prisma.documentInstance.findMany({ where: { companyId, id: { in: [...new Set(ids)] } } });
}

/** Permanently removes an owned instance — used by the generic "delete" action
 *  (actions/generic-actions.ts's registerDeleteAction). 404s via findOwnedDocument the same way every
 *  other single-document operation here does, before ever issuing the delete. */
export async function deleteDocument(
  companyId: string,
  typeId: string,
  id: string,
): Promise<DocumentInstanceResult> {
  await findOwnedDocument(companyId, typeId, id);
  return prisma.documentInstance.delete({ where: { id } });
}
