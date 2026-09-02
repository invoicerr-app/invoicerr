/**
 * TODO_PRODUIT.md T2bis — the shared dispatch for `DOCUMENT_AUTHORITY_EVENT`, the one `DOCUMENT_*`
 * webhook whose "faits propres" (`providerId`, `statusCode`) are genuinely the SAME shape at every
 * one of its three call sites (`conformity/conformity-sweep-runner.ts`, `reporting/reporting-runner.
 * ts`, `transports/sdi/sdi-notifiche.service.ts`) despite each journaling through a different
 * mechanism — the fetch-the-row / build-the-contract / try-catch dance is written ONCE here, not
 * three times over.
 *
 * Deliberately its own file, not `document-webhooks.ts` (kept Prisma-free by design — see that
 * file's own header) nor `../persistence.ts` (CRUD only, no webhook-dispatch concerns).
 *
 * Fetches the row FRESH via `findOwnedDocument` rather than asking every caller to carry one around:
 * `reporting-runner.ts#runReport` already has one in scope at its own two call sites but
 * `recordTerminalFailure` does not, and neither `conformity-sweep-runner.ts` nor
 * `sdi-notifiche.service.ts` ever load a full row today — a single, always-fetch helper is simpler
 * than a union type threading "already have it" vs "go get it" through three different files. The
 * cost is paid ONLY when `webhooks` is actually configured (the very first line below) and only on a
 * `journaled > 0` gate each call site already applies — a genuinely NEW authority verdict, never a
 * re-poll rediscovering something already known — so this is not a hot path.
 *
 * NEVER throws — the identical "side channel, never load-bearing" discipline every other
 * `@Optional()` publisher in this mechanism holds (see e.g. `document-events-publisher.ts`'s own
 * header): whatever goes wrong here must never undo, retry, or even surface past the journal write
 * that already succeeded.
 */
import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { logger } from '@/logger/logger.service';

import { findOwnedDocument } from '../persistence';
import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from './document-webhooks';

export async function dispatchDocumentAuthorityEventWebhook(
  webhooks: DocumentWebhookEmitter | undefined,
  companyId: string,
  typeId: string,
  documentId: string,
  providerId: string,
  statusCode: string,
): Promise<void> {
  if (!webhooks) return;
  try {
    const document = await findOwnedDocument(companyId, typeId, documentId);
    await webhooks.dispatch(
      WebhookEvent.DOCUMENT_AUTHORITY_EVENT,
      buildDocumentWebhookPayload(companyId, typeId, document, { providerId, statusCode }),
    );
  } catch (error) {
    logger.error(
      'Failed to dispatch a DOCUMENT_AUTHORITY_EVENT webhook — the authority event was still journaled',
      {
        category: 'documents',
        details: {
          companyId,
          typeId,
          documentId,
          providerId,
          statusCode,
          message: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }
}
