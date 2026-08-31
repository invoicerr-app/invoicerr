import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { SigningCredentialsPort } from '../signing/signing-credentials-port';
import { runAsyncSendAction } from './async-send';
import { ActionRegistry } from './action-registry';
import { registerEmailRecipientDefaultFromClient, registerSaveDraftAction } from './generic-actions';
import { sendDocumentInstanceEmail } from './send-document-email';

export interface QuoteActionDeps {
  clientsService: ClientsService;
  mailService: MailService;
  typeRegistry: DocumentTypeRegistry;
  referenceRegistry: EntityReferenceRegistry;
  queueDispatcher: DocumentActionQueueDispatcher;
  /** Root TODO item 13 — threaded straight through to `sendDocumentInstanceEmail`, same optional
   *  no-op-when-absent contract as `EmailTransportDeps.signingCertificates`. A quote's own "send" is
   *  unconditionally by email (see this file's own header), so a company with an active certificate
   *  gets a signed quote PDF exactly the way it gets a signed invoice one. */
  signingCertificates?: SigningCredentialsPort;
}

/**
 * Registers the quote type's action IMPLEMENTATIONS. "save-draft" is the generic mechanism
 * (generic-actions.ts) shared with every document type; "send" is the QUOTE's OWN send-by-email
 * mechanism — see quote.descriptor.ts's comment on why this is no longer, and must not become again,
 * shared with the invoice (its transport is always email, unconditionally; the invoice's own is a
 * company setting — invoice-actions.ts). "convert-to-invoice" is implemented in its own file
 * (actions/convert-to-invoice.ts, registered alongside this one in documents.module.ts) rather than
 * here, since it reads a quote's shape and writes an invoice's — it belongs to neither type alone.
 *
 * As of TODO.md item 22, "send" is ASYNCHRONOUS — built on `runAsyncSendAction` (actions/async-send.ts),
 * the exact same two-phase engine the invoice's own "send" now uses (invoice-actions.ts) and the
 * credit note's own too (credit-note-actions.ts). What stays genuinely THIS type's own, and what the
 * shared engine never sees: `deliver()` below always composes and sends a real email (PDF attached,
 * subject/body from quote.descriptor.ts's `email` template or a company override, via
 * `sendDocumentInstanceEmail` — send-document-email.ts) — never a transport lookup, unlike the
 * invoice's own `deliver()`.
 */
export function registerQuoteActions(registry: ActionRegistry, deps: QuoteActionDeps): void {
  registerSaveDraftAction(registry, 'quote');
  registerEmailRecipientDefaultFromClient(registry, 'quote', deps.clientsService);

  registry.register('quote', 'send', async ({ companyId, documentId, data, params }) =>
    runAsyncSendAction({
      companyId,
      typeId: 'quote',
      documentId,
      data,
      params,
      queueDispatcher: deps.queueDispatcher,
      numberOnEnqueue: true, // quote.descriptor.ts: numbering.onEnterStatus === 'sending'
      deliver: async ({ companyId: c, document }) => {
        // `params.recipient` is already validated (required, non-empty text) by
        // DocumentsService.runAction before this handler — and therefore this `deliver` closure —
        // ever runs, the exact same trust boundary "save-draft" already has for `data`. Read from
        // the OUTER `params` (captured by this closure), not `ctx.params`: both are the same value
        // — the job payload round-trips `params` verbatim (queue.constants.ts) — this just avoids a
        // second destructure for the one field this type's own delivery actually needs.
        const recipient = params.recipient as string;
        return sendDocumentInstanceEmail(
          {
            mailService: deps.mailService,
            typeRegistry: deps.typeRegistry,
            referenceRegistry: deps.referenceRegistry,
            signingCertificates: deps.signingCertificates,
          },
          { companyId: c, typeId: 'quote', document, recipient, label: 'Quote' },
        );
      },
    }),
  );
}
