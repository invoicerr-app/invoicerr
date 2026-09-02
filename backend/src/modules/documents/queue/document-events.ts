/**
 * The wire shape for a document status/conformity NUDGE — TODO_PRODUIT.md T1 / PLAN-V2 R8. See
 * `document-events-publisher.ts`'s own header for the full "why Redis pub/sub, why WORKER_INLINE=false
 * requires it" reasoning. Kept in its OWN file, with NO Redis/Nest import at all — the same "pure
 * shape, separate from the plumbing that moves it" split `conformity-sweep.ts` already holds next to
 * `conformity-sweep-runner.ts` — so a plain-function file (`actions/async-send.ts`,
 * `queue/mark-send-failed.ts`) depends on the SHAPE alone, never the concrete ioredis-backed class.
 */

/**
 * Every distinct "something changed, go re-fetch" this mechanism publishes: the three async-send
 * transitions (`actions/async-send.ts`, `queue/mark-send-failed.ts`) — persisted in either the API
 * process (phase 1, "sending") or a BullMQ worker (phase 2, "sent"/"send_failed") — plus one more for
 * a newly-journaled batch of authority events (`conformity/conformity-sweep-runner.ts`,
 * `reporting/reporting-runner.ts`, the SdI push receiver `transports/sdi/sdi-notifiche.service.ts`).
 * See each call site's own comment for exactly which persisted write it follows.
 */
export type DocumentEventKind = 'sending' | 'sent' | 'send_failed' | 'authority-event';

/**
 * Deliberately THIN: never the resulting status/verdict itself, only enough to know WHICH document/
 * type to re-fetch. A message carrying the actual state would be a SECOND source of truth racing
 * whatever the ordinary REST GET already returns — the exact same "an event triggers a refetch, it
 * never REPLACES one" discipline TanStack Query's own cache invalidation already holds everywhere
 * else in this codebase (e.g. `useRunDocumentAction`'s own `invalidateKeys`, frontend). A client that
 * trusted this payload instead of re-fetching could race a slower write and show a status that never
 * actually committed to Postgres.
 */
export interface DocumentEventMessage {
  documentId: string;
  typeId: string;
  kind: DocumentEventKind;
}

/**
 * The narrow shape every publish call site depends on — never the concrete, ioredis-backed
 * `DocumentEventsPublisher` (document-events-publisher.ts): the same "depend on the interface, not
 * the class" discipline `queue.constants.ts`'s own `DocumentActionQueueDispatcher` already holds for
 * `DocumentQueueDispatcher`, for the identical reason — a jest spec passes a bare
 * `{ publish: jest.fn() }`, no Nest, no Redis, no ioredis connection, ever.
 */
export interface DocumentEventPublisher {
  publish(companyId: string, message: DocumentEventMessage): Promise<void>;
}

/**
 * Every company gets its OWN Redis channel — never one shared channel filtered client-side. Scoping
 * by companyId here (not only in the SSE controller's own `@ActiveCompany()` read-side check) means a
 * tenant's events never even reach a subscriber interested in another tenant purely by accident of a
 * shared channel — belt AND suspenders with the read side's own scoping.
 */
const CHANNEL_PREFIX = 'document-events:';

export function documentEventsChannel(companyId: string): string {
  return `${CHANNEL_PREFIX}${companyId}`;
}

/** What the ONE dedicated subscriber connection (`document-events-bridge.ts`) subscribes to — every
 *  company's own channel, in one `PSUBSCRIBE`, never one Redis connection per tenant. */
export const DOCUMENT_EVENTS_CHANNEL_PATTERN = `${CHANNEL_PREFIX}*`;

export function companyIdFromChannel(channel: string): string {
  return channel.slice(CHANNEL_PREFIX.length);
}
