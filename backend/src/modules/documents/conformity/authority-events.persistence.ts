/**
 * Tenant-safe Prisma access for `DocumentAuthorityEvent` — the same "plain functions, scoped by
 * companyId, never a class" discipline `../persistence.ts` and `../archive/persistence.ts` already
 * hold. See the model's own schema comment for the full "append-only, dedup by
 * (documentId, providerId, statusCode)" reasoning this file's two write paths below both lean on.
 *
 * NO update/delete function exists here, and that is deliberate — exactly `../archive/persistence.ts`'s
 * own header: once written, a row is never mutated or removed by this codebase.
 */
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { RawAuthorityEvent } from './authority-status-poller';
import { readConformitySweepBatchSize } from './conformity-sweep';

export interface DocumentAuthorityEventResult {
  id: string;
  companyId: string;
  documentId: string;
  providerId: string;
  statusCode: string;
  statusText: string | null;
  reason: string | null;
  rawPayload: Prisma.JsonValue | null;
  observedAt: Date;
  createdAt: Date;
}

/**
 * Journals every event in `events` for (`companyId`, `documentId`, `providerId`) — `skipDuplicates`
 * is THE dedup mechanism (backed by the model's own `@@unique([documentId, providerId, statusCode])`,
 * enforced by Postgres, not merely checked in application code first): re-polling the same platform
 * events again and again journals each one exactly ONCE, and two genuinely CONCURRENT sweep passes
 * racing on the same document can never produce two rows for the same status code either — see
 * `queue/__tests__/document-conformity-queue.redis.spec.ts` for the real-Redis proof.
 *
 * Returns how many rows were ACTUALLY newly created (Prisma's own `createMany` count already excludes
 * skipped duplicates) — what `conformity-sweep-runner.spec.ts`'s own dedup test asserts on directly,
 * rather than re-querying afterwards to find out.
 */
export async function createAuthorityEvents(
  companyId: string,
  documentId: string,
  providerId: string,
  events: RawAuthorityEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  const { count } = await prisma.documentAuthorityEvent.createMany({
    data: events.map((event) => ({
      companyId,
      documentId,
      providerId,
      statusCode: event.statusCode,
      statusText: event.statusText ?? null,
      reason: event.reason ?? null,
      rawPayload: (event.rawPayload ?? undefined) as Prisma.InputJsonValue | undefined,
      observedAt: event.observedAt,
    })),
    skipDuplicates: true,
  });
  return count;
}

/**
 * Journals exactly ONE synthetic event this codebase invented (never received from a platform) —
 * `GAVE_UP_STATUS_CODE`/`BLOCKED_STATUS_CODE` (`conformity-sweep.ts`). Same dedup guarantee as
 * `createAuthorityEvents` above (it IS that function, called with a single, synthetic entry): a
 * 'poll:gave-up' that must be journaled "une seule fois" is exactly what the
 * unique constraint already gives for free, needing no extra existence check here.
 */
export async function journalSyntheticEvent(
  companyId: string,
  documentId: string,
  providerId: string,
  statusCode: string,
  reason: string,
  observedAt: Date = new Date(),
): Promise<number> {
  return createAuthorityEvents(companyId, documentId, providerId, [{ statusCode, reason, observedAt }]);
}

/** Every authority event journaled for this document, most recent (by `observedAt`) first — what the
 *  frontend's own conformity timeline renders (`GET /documents/:id/authority-events`). */
export async function listAuthorityEvents(
  companyId: string,
  documentId: string,
): Promise<DocumentAuthorityEventResult[]> {
  return prisma.documentAuthorityEvent.findMany({
    where: { companyId, documentId },
    orderBy: { observedAt: 'desc' },
  });
}

/**
 * Cross-tenant lookup by (`channelProviderId`, `transportRef`) — the same "resolve by a globally-
 * scoped key, hand back the companyId" shape `share-links/share-links.service.ts#resolvePublicToken`
 * already holds for its own public, unauthenticated caller. Needed by
 * `sdi-notifiche.service.ts`: SdI's own push notifiche carry an `IdentificativoSdI`
 * (`transportRef`) and NOTHING else identifying which company/document it belongs to — a value SdI
 * itself assigns globally (one `RiceviFile` submission, one identifier), never scoped to a tenant on
 * our side. Returns `null` for an unknown ref (the exact "notifica for a document we never sent, or
 * already forgot" case `sdi-notifiche.service.ts`'s own header handles) — never throws, the same
 * "unknown token = null, not an error" discipline `resolvePublicToken` holds.
 */
export async function findDocumentByTransportRef(
  channelProviderId: string,
  transportRef: string,
): Promise<{ id: string; companyId: string; typeId: string } | null> {
  const row = await prisma.documentInstance.findFirst({
    where: { channelProviderId, transportRef },
    // `typeId` is what lets
    // `sdi-notifiche.service.ts` publish a `{documentId, typeId, kind: 'authority-event'}` SSE nudge
    // — the frontend's own query keys (`["documents", typeId, id, "authority-events"]`) need BOTH to
    // invalidate the right cache entry, never `documentId` alone.
    select: { id: true, companyId: true, typeId: true },
  });
  return row;
}

/**
 * The TENANT-SCOPED sibling of `findDocumentByTransportRef` above — for every caller that DOES
 * already know which company a notifica belongs to before ever resolving the document, unlike SdI's
 * own SOAP push (there is genuinely no per-tenant identity in that transport at all — see the
 * function above's own header). `pec-notifiche.service.ts` is called by
 * `pec-inbox-poller.service.ts` polling ONE specific company's OWN configured mailbox: `companyId` is
 * a parameter it already holds, so resolving the notifica's `NomeFile` WITHOUT it (as the code used
 * to) meant a filename collision — or one deliberately forged by whoever controls the mailbox's
 * sender — could journal an authority event onto ANOTHER tenant's document. `null` for "no document
 * with this ref at all" AND for "one exists, but not owned by this company" — the two are
 * indistinguishable to the caller, on purpose (the same posture `findOwnedDocument`, `persistence.ts`,
 * already holds for every other single-document lookup in this module).
 */
export async function findOwnedDocumentByTransportRef(
  companyId: string,
  channelProviderId: string,
  transportRef: string,
): Promise<{ id: string; companyId: string; typeId: string } | null> {
  const row = await prisma.documentInstance.findFirst({
    where: { companyId, channelProviderId, transportRef },
    select: { id: true, companyId: true, typeId: true },
  });
  return row;
}

export interface ConformitySweepCandidateRow {
  id: string;
  companyId: string;
  typeId: string;
  transportRef: string;
  channelProviderId: string;
  updatedAt: Date;
  existingStatusCodes: string[];
}

/**
 * Every document the sweep even CONSIDERS this pass — `status: 'sent'`, a non-null `transportRef`
 * (nothing to poll without one), a `channelProviderId` the poller REGISTRY actually knows how to poll
 * (`pollableProviderIds`, resolved by the caller — never hard-coded here: "sdi" is excluded simply by
 * never being in that list, see `authority-status-poller.ts`'s own header), and — the filter that
 * actually keeps this query BOUNDED at scale — `conformityResolvedAt: null`.
 *
 * That last clause is why a document whose conformity was already resolved (a real terminal verdict,
 * or a 'poll:gave-up') stops being fetched AT ALL from the very next pass onward, rather than being
 * loaded — with its full `authorityEvents` relation — on EVERY 60s pass forever only to be `skip`ped
 * in memory a moment later (`conformity-sweep.ts#decideConformityAction`): at scale (tens of
 * thousands of long-since-terminal "sent" invoices) that in-memory skip was cheap PER ROW but the
 * unbounded `findMany` fetching every one of those rows, joined with its own events, every single
 * pass, was not. `conformityResolvedAt` is written by `conformity-sweep-runner.ts` the moment it
 * decides a document is terminal (or gives up on it) — see that column's own schema comment for why
 * this table, not a per-provider "terminal status codes" list, is the source of truth: only the
 * POLLER that produced a code knows whether its own vocabulary calls it terminal, this query has no
 * business re-deriving that.
 *
 * `take` (`readConformitySweepBatchSize`, default 500) is the SECOND, independent bound: even the set
 * of genuinely NOT-YET-resolved candidates could be large if one pollable channel is very busy —
 * `orderBy: updatedAt asc` means the OLDEST still-pending documents are polled first each pass, so a
 * batch limit can never starve a document forever (it works its way to the front once the ones ahead
 * of it resolve or give up), the same "oldest-first, bounded window" fairness `reception-sweep-
 * runner.ts` already applies for its own inbound dedup query.
 *
 * A document sent by "email" (`channelProviderId` null) never matches `in: pollableProviderIds`
 * (`null` cannot equal any string in the list) — the exact "email = non" case the eligibility test
 * names.
 */
export async function findConformitySweepCandidates(
  pollableProviderIds: string[],
  take: number = readConformitySweepBatchSize(),
): Promise<ConformitySweepCandidateRow[]> {
  if (pollableProviderIds.length === 0) return [];
  const rows = await prisma.documentInstance.findMany({
    where: {
      status: 'sent',
      transportRef: { not: null },
      channelProviderId: { in: pollableProviderIds },
      conformityResolvedAt: null,
    },
    orderBy: { updatedAt: 'asc' },
    take,
    include: { authorityEvents: { select: { statusCode: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    typeId: row.typeId,
    // Never actually null here (filtered by the WHERE clause above) — TypeScript just can't see that
    // through Prisma's own generated types, so this narrows explicitly rather than asserting blind.
    transportRef: row.transportRef ?? '',
    channelProviderId: row.channelProviderId ?? '',
    updatedAt: row.updatedAt,
    existingStatusCodes: row.authorityEvents.map((event) => event.statusCode),
  }));
}

/**
 * Marks `documentId`'s conformity as RESOLVED — the ONE write `findConformitySweepCandidates` above
 * filters on, so it never re-fetches this row again. Called by `conformity-sweep-runner.ts` from
 * exactly two places: the moment a POLL observes a code the provider's own `isTerminal` calls
 * terminal, and the moment the sweep itself gives up (`GAVE_UP_STATUS_CODE`) — both already know this
 * is the right call to make, this function just performs the write. Also what SELF-HEALS a document
 * that was ALREADY terminal before this column existed (every pre-migration row starts with a null
 * `conformityResolvedAt`): the runner's own 'skip' branch calls this the first time it re-encounters
 * one, so a one-time backlog converges to fully marked within a few sweep passes rather than needing a
 * dedicated backfill migration. Idempotent by nature (a plain overwrite, no uniqueness to violate) —
 * two racing passes reaching the same conclusion about the same document is harmless.
 */
export async function markConformityResolved(
  documentId: string,
  resolvedAt: Date = new Date(),
): Promise<void> {
  await prisma.documentInstance.update({
    where: { id: documentId },
    data: { conformityResolvedAt: resolvedAt },
  });
}
