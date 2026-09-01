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
 * 'poll:gave-up' this task's own rule says must be journaled "une seule fois" is exactly what the
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
): Promise<{ id: string; companyId: string } | null> {
  const row = await prisma.documentInstance.findFirst({
    where: { channelProviderId, transportRef },
    select: { id: true, companyId: true },
  });
  return row;
}

export interface ConformitySweepCandidateRow {
  id: string;
  companyId: string;
  transportRef: string;
  channelProviderId: string;
  updatedAt: Date;
  existingStatusCodes: string[];
}

/**
 * Every document the sweep even CONSIDERS this pass — `status: 'sent'`, a non-null `transportRef`
 * (nothing to poll without one), and a `channelProviderId` the poller REGISTRY actually knows how to
 * poll (`pollableProviderIds`, resolved by the caller — never hard-coded here: "sdi" is excluded
 * simply by never being in that list, see `authority-status-poller.ts`'s own header). Terminal
 * filtering happens AFTER this query, in `conformity-sweep.ts#decideConformityAction` — a pure
 * function over `existingStatusCodes`, fetched here via the relation in ONE query (never N+1).
 *
 * A document sent by "email" (`channelProviderId` null) never matches `in: pollableProviderIds`
 * (`null` cannot equal any string in the list) — the exact "email = non" case this task's own
 * eligibility test names.
 */
export async function findConformitySweepCandidates(
  pollableProviderIds: string[],
): Promise<ConformitySweepCandidateRow[]> {
  if (pollableProviderIds.length === 0) return [];
  const rows = await prisma.documentInstance.findMany({
    where: {
      status: 'sent',
      transportRef: { not: null },
      channelProviderId: { in: pollableProviderIds },
    },
    include: { authorityEvents: { select: { statusCode: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    // Never actually null here (filtered by the WHERE clause above) — TypeScript just can't see that
    // through Prisma's own generated types, so this narrows explicitly rather than asserting blind.
    transportRef: row.transportRef ?? '',
    channelProviderId: row.channelProviderId ?? '',
    updatedAt: row.updatedAt,
    existingStatusCodes: row.authorityEvents.map((event) => event.statusCode),
  }));
}
