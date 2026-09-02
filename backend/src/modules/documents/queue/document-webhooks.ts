/**
 * The wire shape for the OUTBOUND webhook a "sent" transition announces to a THIRD PARTY —
 * TODO_PRODUIT.md T2 / PLAN-V2 R9. Kept in its own file, with NO Nest/Prisma-service import at all —
 * the same "pure shape, separate from the plumbing that moves it" split `document-events.ts` already
 * holds for the SSE nudge right next to it, so `actions/async-send.ts` depends on the SHAPE alone,
 * never the concrete `WebhookDispatcherService` (`modules/webhooks/webhook-dispatcher.service.ts`) —
 * a jest spec passes a bare `{ dispatch: jest.fn() }`, no Nest, no Prisma, no HTTP involved at all.
 *
 * ## Why this is a DIFFERENT concept from `DocumentEventPublisher` (document-events.ts)
 *
 * The SSE nudge is an in-house signal, deliberately THIN (never the resulting state — see that
 * file's own header) — a browser re-fetches from the ordinary REST GET. A webhook is the OPPOSITE: it
 * IS the payload a third party's own system consumes, and it goes out AT MOST ONCE per document (see
 * `async-send.ts`'s own header on why "sent" is the only acquisition point that can fire it) — never
 * "fire and let the reader reconcile", since there is no reader to reconcile with, only whatever the
 * receiving end already did with the first (and only) delivery.
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
