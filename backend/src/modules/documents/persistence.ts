import { Prisma } from '../../../prisma/generated/prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
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
 * THE CROSS-PROCESS DELIVERY-CONFIRMATION WRITE — see `DocumentInstance.deliveryConfirmedAt`'s own
 * schema comment for the full guarantee. Called from `actions/async-send.ts`'s phase-2, ONCE,
 * immediately after `deliver()` has genuinely returned success and BEFORE that same code ever
 * attempts the "sending" -> "sent" write — never conditional on the row's current status (unlike
 * `updateManyConditionally`'s callers above): by the time this runs, the caller already holds BOTH
 * the in-process claim and the database claim (`claimDocumentTransition`), so there is no concurrent
 * writer left to race against, only the risk that THIS write itself throws (a transient DB hiccup) —
 * exactly the case `actions/async-send.ts`'s own bounded local retry around this call exists for.
 *
 * A plain, unconditional `update` by id: safe to call more than once with the same values (an
 * internal retry that actually succeeded on a prior attempt despite the caller observing a network
 * timeout would simply re-write the identical fact), and there is nothing to clear on a later
 * ordinary write the way `lastActionError` needs clearing — once delivery has genuinely happened, it
 * stays true forever, through any number of subsequent "send_failed"/"sending" cycles for the SAME
 * document (see the schema comment's own "never cleared" paragraph).
 */
export async function confirmDelivery(
  companyId: string,
  typeId: string,
  id: string,
  transportRef?: string,
  channelProviderId?: string,
): Promise<DocumentInstanceResult> {
  await findOwnedDocument(companyId, typeId, id);
  return prisma.documentInstance.update({
    where: { id },
    data: {
      deliveryConfirmedAt: new Date(),
      ...(transportRef !== undefined ? { transportRef } : {}),
      ...(channelProviderId !== undefined ? { channelProviderId } : {}),
    },
  });
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

/** The real columns `GET /documents` may sort by — deliberately NOT `issueDate` or any other field
 *  living inside `data` (see `dateValueInRange` below for why a JSON path never gets a computed SQL
 *  ORDER BY here). `number` sorts numbered instances by their take-a-number sequence; an
 *  un-numbered type's rows (all `number: null`) fall back to Postgres's own NULLS ordering, which is
 *  an honest "no ordering opinion" for a type this key means nothing for. */
export const DOCUMENT_LIST_SORT_FIELDS = ['updatedAt', 'createdAt', 'number', 'status'] as const;
export type DocumentListSortField = (typeof DOCUMENT_LIST_SORT_FIELDS)[number];

export interface ListDocumentsPageOptions {
  /** Absent means "every type" — the pre-existing, still-supported shape of this route (see
   *  `utils/scope-check.ts`'s own "coarse fallback for a document-shaped REST route that does NOT
   *  carry a typeId" comment). `clientId`/date/`q` filtering all read ONE type's own descriptor, so
   *  `DocumentsService` refuses those with a 400 before this ever runs without a `typeId` — this
   *  module itself has no opinion, it just applies whatever it's handed. */
  typeId?: string;
  page: number;
  pageSize: number;
  status?: string[];
  sort: DocumentListSortField;
  order: 'asc' | 'desc';
  /** The `data` key this type's own descriptor uses for its client-reference field, resolved by the
   *  CALLER (DocumentsService, the only layer that knows a type's fields) — this module stays a dumb
   *  Prisma layer, never itself aware of what a "client" field is for a given type. Absent when the
   *  type declares no such field; `clientId` is then simply not applied (the caller already refused
   *  the request with a 400 before it ever reaches here — see `list-filters.ts#resolveClientFieldKey`). */
  clientFieldKey?: string;
  clientId?: string;
  /** The `data` key this type's own descriptor uses for its issuance date
   *  (`list-filters.ts#resolveDateFieldKey`) — same "resolved by the caller" reasoning as
   *  `clientFieldKey`. `dateFrom`/`dateTo` are already-validated `YYYY-MM-DD` strings (the
   *  controller's own `parseListDocumentsQuery`), never a bare `Date` — this function is the one
   *  place that turns them into UTC-day boundaries, right next to `dateValueInRange`, which compares
   *  against the exact same boundaries. */
  dateFieldKey?: string;
  dateFrom?: string;
  dateTo?: string;
  /** The raw search term — matched against `displayNumber` (a real column, `contains`) and, when
   *  given, every one of `searchTextFieldKeys` (`data` path `string_contains`) — plus, when
   *  `clientFieldKey` is set, an exact `equals` per id in `searchClientIds` (ids whose OWN name
   *  matched `q`, resolved by the caller — this module never queries `Client` itself). All ORed
   *  together; absent/blank applies no search narrowing at all. */
  q?: string;
  searchTextFieldKeys?: string[];
  searchClientIds?: string[];
}

export interface ListDocumentsPageResult {
  items: DocumentInstanceResult[];
  total: number;
  page: number;
  pageSize: number;
}

/** Same cap discipline `accounting-export.service.ts`'s own `ACCOUNTING_EXPORT_READ_LIMIT` already
 *  holds for the identical constraint (a JSON-embedded date has no SQL ORDER BY/range this codebase
 *  trusts — see this function's own header): an honest "most recently touched N documents" read, not
 *  an unbounded table scan, whenever a date filter forces the in-memory path below. Larger than the
 *  accounting export's own 500 — this is a general list, not one bounded to a single fiscal period. */
export const DOCUMENT_LIST_DATE_FILTER_READ_CAP = 2000;

/** `"YYYY-MM-DD"` -> the UTC midnight of that day, in milliseconds — the exact same conversion
 *  `accounting-export.service.ts#dayMs` already holds for the identical param shape, duplicated
 *  rather than imported (a sibling, single-purpose concern; see `dateValueInRange`'s own header for
 *  why this whole file doesn't reuse that module instead). */
function dayMs(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whether `dateValue` (whatever `data[dateFieldKey]` currently holds — normally an ISO string, e.g.
 *  from a 'date' field's own `toISOString()`) falls within `[fromMs, toMs]`, each bound optional and
 *  inclusive, compared at UTC day boundaries — the exact same rule
 *  `accounting-export.service.ts#issueDateInRange` already applies to the SAME kind of field.
 *  Missing/unparseable -> excluded: a document with no readable date cannot honestly be placed in
 *  ANY range — an honest default, never a guess. Duplicated here rather than imported from that
 *  service (a sibling, single-purpose concern — persistence.ts owes accounting-export nothing, and a
 *  future change to one's own rounding must not silently reach into the other). */
function dateValueInRange(dateValue: unknown, fromMs: number | undefined, toMs: number | undefined): boolean {
  if (typeof dateValue !== 'string') return false;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return false;
  const ms = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  if (fromMs !== undefined && ms < fromMs) return false;
  if (toMs !== undefined && ms > toMs) return false;
  return true;
}

/** Every already-DB-pushable OR term `q` resolves to — see `ListDocumentsPageOptions.q`'s own header
 *  for what each term means. `[]` (never applied as a WHERE clause) when `q` is blank. */
function buildSearchOr(options: ListDocumentsPageOptions): Prisma.DocumentInstanceWhereInput[] {
  if (!options.q) return [];
  const terms: Prisma.DocumentInstanceWhereInput[] = [
    { displayNumber: { contains: options.q, mode: 'insensitive' } },
  ];
  for (const key of options.searchTextFieldKeys ?? []) {
    terms.push({ data: { path: [key], string_contains: options.q, mode: 'insensitive' } });
  }
  if (options.clientFieldKey) {
    for (const id of options.searchClientIds ?? []) {
      terms.push({ data: { path: [options.clientFieldKey], equals: id } });
    }
  }
  return terms;
}

/**
 * The paginated, filtered companion to `listDocuments` above — what `GET /documents` (the list
 * screen) actually calls today; `listDocuments` itself stays untouched for its dozen other callers
 * (contributions, reconciliation, the accounting export…), every one of which wants an honestly-
 * capped, unpaginated read, never a page.
 *
 * Two different execution paths, chosen by whether a date-range filter is present:
 *  - No date filter: `status`/`clientId`/`searchOr` are already ordinary Prisma WHERE clauses
 *    (a real column, an exact JSON-path `equals`, and `string_contains`/`equals` OR terms
 *    respectively — all three push down to SQL cleanly), so pagination is a plain `skip`/`take` +
 *    `count`, exactly the fast path a table this size deserves.
 *  - A date filter is present: `dateFieldKey` names a field living inside the JSON `data` blob,
 *    which Prisma/Postgres has no trustworthy ORDER BY or range comparison for that agrees with this
 *    codebase's own notion of "a valid date" (see `dateValueInRange`'s own header — a malformed
 *    value must read as EXCLUDED, never as an arbitrary lexicographic sort position a raw jsonb
 *    comparison would silently produce). So the range is applied in application code, over a capped
 *    candidate set already narrowed by every DB-pushable clause, and pagination becomes an in-memory
 *    slice of the SURVIVORS — `total` is the survivor count, honestly bounded by the same cap.
 */
export async function listDocumentsPage(
  companyId: string,
  options: ListDocumentsPageOptions,
): Promise<ListDocumentsPageResult> {
  const searchOr = buildSearchOr(options);
  const where: Prisma.DocumentInstanceWhereInput = {
    companyId,
    ...(options.typeId ? { typeId: options.typeId } : {}),
    ...(options.status && options.status.length > 0 ? { status: { in: options.status } } : {}),
    ...(options.clientId && options.clientFieldKey
      ? { data: { path: [options.clientFieldKey], equals: options.clientId } }
      : {}),
    ...(searchOr.length > 0 ? { OR: searchOr } : {}),
  };
  const orderBy = { [options.sort]: options.order } as Prisma.DocumentInstanceOrderByWithRelationInput;

  const hasDateFilter = !!(options.dateFrom || options.dateTo);
  if (!hasDateFilter) {
    const [items, total] = await Promise.all([
      prisma.documentInstance.findMany({
        where,
        orderBy,
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      prisma.documentInstance.count({ where }),
    ]);
    return { items, total, page: options.page, pageSize: options.pageSize };
  }

  const candidates = await prisma.documentInstance.findMany({
    where,
    orderBy,
    take: DOCUMENT_LIST_DATE_FILTER_READ_CAP,
  });
  // Hitting the cap exactly means there may be MORE rows this WHERE clause would otherwise have
  // matched, beyond what was ever read — `total` below is then the survivor count of a truncated
  // candidate set, not a true total, and a company approaching this in ordinary use is a real
  // capacity signal a raised cap or a dedicated export (accounting-export.service.ts already exists
  // for exactly that) should pick up, not something that should only ever be discovered by a support
  // ticket about a document that "isn't in the list".
  if (candidates.length === DOCUMENT_LIST_DATE_FILTER_READ_CAP) {
    logger.warn('Date-filtered document list hit its in-memory read cap — total may be undercounted', {
      category: 'documents',
      details: { typeId: options.typeId, cap: DOCUMENT_LIST_DATE_FILTER_READ_CAP },
    });
  }
  const dateFieldKey = options.dateFieldKey;
  const fromMs = options.dateFrom ? dayMs(options.dateFrom) : undefined;
  const toMs = options.dateTo ? dayMs(options.dateTo) : undefined;
  const survivors = dateFieldKey
    ? candidates.filter((doc) =>
        dateValueInRange((doc.data as Record<string, unknown> | null)?.[dateFieldKey], fromMs, toMs),
      )
    : candidates;
  const start = (options.page - 1) * options.pageSize;
  return {
    items: survivors.slice(start, start + options.pageSize),
    total: survivors.length,
    page: options.page,
    pageSize: options.pageSize,
  };
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
