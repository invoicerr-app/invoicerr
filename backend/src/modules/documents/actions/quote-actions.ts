import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { ActionRegistry } from './action-registry';
import {
  registerEmailRecipientDefaultFromClient,
  registerEmailSendAction,
  registerSaveDraftAction,
} from './generic-actions';

export interface QuoteActionDeps {
  clientsService: ClientsService;
  mailService: MailService;
  typeRegistry: DocumentTypeRegistry;
  referenceRegistry: EntityReferenceRegistry;
}

/**
 * Registers the quote type's action IMPLEMENTATIONS. "save-draft" is the generic mechanism
 * (generic-actions.ts) shared with every document type; "send" is the QUOTE's OWN send-by-email
 * mechanism (generic-actions.ts's registerEmailSendAction/registerEmailRecipientDefaultFromClient —
 * see that file's comment for why this is no longer, and must not become again, shared with the
 * invoice). "convert-to-invoice" is implemented in its own file (actions/convert-to-invoice.ts,
 * registered alongside this one in documents.module.ts) rather than here, since it reads a quote's
 * shape and writes an invoice's — it belongs to neither type alone.
 *
 * The email itself (PDF attached, subject/body from quote.descriptor.ts's `email` template or a
 * company override) is composed by `registerEmailSendAction` via `sendDocumentInstanceEmail`
 * (send-document-email.ts) — this file no longer builds its own plain-text body (the former
 * `buildQuoteEmailText`/email-text.ts, removed: the PDF now carries the line detail the text used to
 * list by hand).
 */
export function registerQuoteActions(registry: ActionRegistry, deps: QuoteActionDeps): void {
  registerSaveDraftAction(registry, 'quote');
  registerEmailRecipientDefaultFromClient(registry, 'quote', deps.clientsService);
  registerEmailSendAction(registry, 'quote', 'Quote', {
    mailService: deps.mailService,
    typeRegistry: deps.typeRegistry,
    referenceRegistry: deps.referenceRegistry,
  });
}
