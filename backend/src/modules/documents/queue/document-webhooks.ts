/**
 * The wire shape for the OUTBOUND webhooks a document's own lifecycle announces to a THIRD PARTY —
 * TODO_PRODUIT.md T2bis (generic `DOCUMENT_*` vocabulary), superseding T2 / PLAN-V2 R9's own
 * per-type `INVOICE_SENT`/`QUOTE_SENT`. Kept in its own file, with NO Nest/Prisma-service import at
 * all — the same "pure shape, separate from the plumbing that moves it" split `document-events.ts`
 * already holds for the SSE nudge right next to it, so every call site (`actions/async-send.ts`,
 * `queue/mark-send-failed.ts`, `actions/generic-actions.ts`) depends on the SHAPE alone, never the
 * concrete `WebhookDispatcherService` (`modules/webhooks/webhook-dispatcher.service.ts`) — a jest
 * spec passes a bare `{ dispatch: jest.fn() }`, no Nest, no Prisma, no HTTP involved at all.
 *
 * ## Why this is a DIFFERENT concept from `DocumentEventPublisher` (document-events.ts)
 *
 * The SSE nudge is an in-house signal, deliberately THIN (never the resulting state — see that
 * file's own header) — a browser re-fetches from the ordinary REST GET. A webhook is the OPPOSITE: it
 * IS the payload a third party's own system consumes. Unlike the SSE nudge, a `DOCUMENT_*` webhook is
 * NOT always "at most once per document" — `DOCUMENT_SENT`/`DOCUMENT_CREATED`/`DOCUMENT_DELETED` are
 * (each names a write that can only ever happen once for a given document), but
 * `DOCUMENT_AUTHORITY_EVENT` fires once per NEWLY journaled authority verdict, which can be more than
 * one per document (a poll, then a later declaration, ...) — see
 * `queue/document-authority-webhook.ts`'s own header.
 *
 * `dispatch` mirrors `WebhookDispatcherService.dispatch(event, payload)` EXACTLY (same two positional
 * arguments, same "logs then rethrows on failure" contract every existing caller —
 * `company.service.ts`, `clients.service.ts` — already wraps in its own try/catch) so the concrete
 * class satisfies this interface with NO adapter needed: `documents-core.module.ts` hands the real
 * `WebhookDispatcherService` instance straight through.
 */
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

export interface DocumentWebhookEmitter {
  dispatch(event: WebhookEvent, payload: Record<string, unknown>): Promise<void>;
}

/**
 * TODO_PRODUIT.md T2bis — the Nest injection TOKEN for `DocumentWebhookEmitter`, used by every
 * consumer that needs NEST'S OWN constructor injection (`ConformitySweepRunner`,
 * `SdiNotificheService`, `DocumentActionProcessor`) rather than a value threaded by hand through a
 * factory (`buildActionRegistry`, `async-send.ts`'s own callers). A bare TS interface has no runtime
 * representation, so Nest cannot resolve it by TYPE the way it resolves a concrete class — `@Inject
 * (DOCUMENT_WEBHOOK_EMITTER)` is the standard Nest way to inject an ABSTRACTION by token while the
 * field itself stays typed as the interface.
 *
 * This is NOT merely style: typing that constructor parameter as the CONCRETE
 * `WebhookDispatcherService` class (as `eventsPublisher: DocumentEventsPublisher` — a genuinely
 * different, Prisma/Redis-only class — already does elsewhere) would force every file that imports
 * one of those three classes to pull in `webhook-dispatcher.service.ts` → `webhooks.service.ts` →
 * `drivers/discord.driver.ts` → `@teever/ez-hook`, the pure-ESM package ts-jest cannot compile
 * (TODO_ISSUES.md's own "ClientsModule inimportable sous ts-jest" entry) — breaking not just those
 * three classes' own spec files but every OTHER spec that transitively imports them (found the hard
 * way: `document-action.processor.spec.ts`, the four `queue/__tests__/*.redis.spec.ts` integration
 * specs, `sdi-notifiche.controller.spec.ts`). Depending on this token (a plain `Symbol`, never a
 * class) and the bare interface keeps every one of those specs compiling with nothing but a plain
 * `{ dispatch: jest.fn() }`, exactly like `async-send.ts`'s own `DocumentWebhookEmitter` field always
 * has. `documents-core.module.ts`/`sdi-notifiche.module.ts` provide it with
 * `{ provide: DOCUMENT_WEBHOOK_EMITTER, useExisting: WebhookDispatcherService }` — the concrete class
 * is referenced ONLY in those two wiring files (and `webhooks.module.ts` itself), never anywhere a
 * jest spec has to follow.
 */
export const DOCUMENT_WEBHOOK_EMITTER = Symbol('DOCUMENT_WEBHOOK_EMITTER');

/**
 * The uniform payload EVERY `DOCUMENT_*` webhook carries — TODO_PRODUIT.md T2bis's own "contrat de
 * payload uniforme", decided with the mandant specifically so a receiver never needs a per-type
 * branch to find the row: `document` is a FIXED key, always the untouched `DocumentInstance` row,
 * never the per-type computed key (`{ invoice: sent }`/`{ quote: sent }`) T2's own payload used —
 * `typeId` is what a receiver filters on instead. A future document type gets every `DOCUMENT_*`
 * event for free, with the exact same shape, no new formatter, no new payload convention.
 *
 * `factsBesidesDocument` is whatever else genuinely differs by event — `error` for
 * `DOCUMENT_SEND_FAILED`, `providerId`/`statusCode` for `DOCUMENT_AUTHORITY_EVENT` — spread AFTER the
 * base fields so a future fact can never accidentally shadow `documentId`/`typeId`/`companyId`/
 * `occurredAt`/`document` (a caller passing one of those keys would be a bug, not a legitimate
 * override, but this ordering makes the base contract win either way).
 *
 * `occurredAt` is "now" at the moment this function builds the payload, deliberately — not the
 * document row's own `updatedAt`: the two are for-practical-purposes simultaneous at every call site
 * (this always runs immediately after the fact it announces was acquired in Postgres, see e.g.
 * `async-send.ts`'s own header), and using "now" here means the field means the exact same thing at
 * every one of the five events, including `DOCUMENT_AUTHORITY_EVENT` (whose OWN "when did the
 * authority actually observe this" already has its own dedicated field — `DocumentAuthorityEvent.
 * observedAt` — visible through the ordinary REST read, not duplicated into the webhook payload).
 */
export function buildDocumentWebhookPayload<TDocument extends { id: string }>(
  companyId: string,
  typeId: string,
  document: TDocument,
  factsBesidesDocument: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    documentId: document.id,
    typeId,
    companyId,
    occurredAt: new Date().toISOString(),
    document,
    ...factsBesidesDocument,
  };
}
