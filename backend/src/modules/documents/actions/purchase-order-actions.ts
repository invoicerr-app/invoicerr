import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';
import { logger } from '@/logger/logger.service';

import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { updateDocumentStatus } from '../persistence';
import { DocumentEventPublisher } from '../queue/document-events';
import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from '../queue/document-webhooks';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { SigningCredentialsPort } from '../signing/signing-credentials-port';
import { runAsyncSendAction } from './async-send';
import { ActionRegistry } from './action-registry';
import { registerEmailRecipientDefaultFromClient, registerSaveDraftAction } from './generic-actions';
import { sendDocumentInstanceEmail } from './send-document-email';

export interface PurchaseOrderActionDeps {
  clientsService: ClientsService;
  mailService: MailService;
  typeRegistry: DocumentTypeRegistry;
  referenceRegistry: EntityReferenceRegistry;
  queueDispatcher: DocumentActionQueueDispatcher;
  /** See `QuoteActionDeps.signingCertificates`'s own header — same optional, no-op-when-absent
   *  contract, threaded straight through to `sendDocumentInstanceEmail`. */
  signingCertificates?: SigningCredentialsPort;
  /** See `async-send.ts`'s own `RunAsyncSendInput.events` header. */
  events?: DocumentEventPublisher;
  /** See `async-send.ts`'s own `RunAsyncSendInput.webhooks` header. */
  webhooks?: DocumentWebhookEmitter;
}

/**
 * Registers the purchase order type's action IMPLEMENTATIONS — see purchase-order.descriptor.ts's own
 * header for the full "why" behind every choice below. "save-draft" is the generic mechanism
 * (generic-actions.ts) shared with every document type; "send" is unconditionally by email, on the
 * EXACT same model as quote-actions.ts's own "send" (never the invoice's company-configured-transport
 * one — a purchase order going to one known supplier by email is the same defensible default a signed
 * quote going to one known client already is), the only difference being WHICH field carries the
 * recipient's own id ('supplier', not 'client' — see `registerEmailRecipientDefaultFromClient`'s own
 * header for why that is now a parameter rather than a hardcoded key).
 *
 * "cancel-order" is a plain, synchronous status-only write — no transport, no email, no data
 * rewrite — mirroring invoice-actions.ts's own "cancel" in EVERYTHING except:
 *  - the action id itself (see the descriptor's own header for why "cancel" would be silently
 *    unreachable from the screen for a type with no dedicated custom-slot button);
 *  - the country-policy gate: nothing here routes through `correction-routes/cancel-policy.ts` (that
 *    mechanism is `documents.service.ts#resolveActionPolicy`'s own special case for
 *    `typeId === 'invoice' && actionId === 'cancel'` specifically — a purchase order's own
 *    "purchase-order.cancel-order" rule is read from the ordinary `country-policy/data/*.json`
 *    catalog, ONE unverified-but-uniform rule per country, since cancelling a purchase order is a
 *    business decision, never a legal correction route).
 */
export function registerPurchaseOrderActions(registry: ActionRegistry, deps: PurchaseOrderActionDeps): void {
  registerSaveDraftAction(registry, 'purchase-order', deps.webhooks);
  registerEmailRecipientDefaultFromClient(registry, 'purchase-order', deps.clientsService, 'supplier');

  registry.register('purchase-order', 'send', async ({ companyId, documentId, data, params }) =>
    runAsyncSendAction({
      companyId,
      typeId: 'purchase-order',
      documentId,
      data,
      params,
      queueDispatcher: deps.queueDispatcher,
      events: deps.events,
      webhooks: deps.webhooks,
      numberOnEnqueue: true, // purchase-order.descriptor.ts: numbering.onEnterStatus === 'sending'
      deliver: async ({ companyId: c, document }) => {
        // See quote-actions.ts's own identical comment: `params.recipient` is already validated
        // (required, non-empty text) by DocumentsService.runAction before this closure ever runs.
        const recipient = params.recipient as string;
        return sendDocumentInstanceEmail(
          {
            mailService: deps.mailService,
            typeRegistry: deps.typeRegistry,
            referenceRegistry: deps.referenceRegistry,
            signingCertificates: deps.signingCertificates,
          },
          { companyId: c, typeId: 'purchase-order', document, recipient, label: 'Purchase order' },
        );
      },
    }),
  );

  /**
   * "cancel-order" — see this file's own header, and the descriptor's own, for the full reasoning.
   * A STATUS-ONLY write, `number`/`displayNumber` untouched (same as invoice-actions.ts's "cancel" —
   * a cancelled purchase order keeps existing, exactly as sent, only its status changes).
   */
  registry.register('purchase-order', 'cancel-order', async ({ companyId, documentId }) => {
    if (!documentId) {
      // Unreachable in practice — `availableWhen: ['sent', 'send_failed']` already refuses this
      // before the handler runs (a never-saved record has no status to match) — but a handler never
      // trusts that alone, the same defensive posture every other action in this module already holds.
      throw new Error('Cannot cancel a purchase order that has not been saved yet.');
    }

    const document = await updateDocumentStatus(companyId, 'purchase-order', documentId, 'cancelled');

    if (deps.webhooks) {
      try {
        await deps.webhooks.dispatch(
          WebhookEvent.DOCUMENT_CANCELLED,
          buildDocumentWebhookPayload(companyId, 'purchase-order', document),
        );
      } catch (error) {
        logger.error(
          'Failed to dispatch a DOCUMENT_CANCELLED webhook — the purchase order was still cancelled',
          {
            category: 'documents',
            details: {
              companyId,
              typeId: 'purchase-order',
              documentId,
              message: error instanceof Error ? error.message : String(error),
            },
          },
        );
      }
    }

    return { document, changed: true, message: 'Cancelled.' };
  });
}
