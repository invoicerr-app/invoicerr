import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { ActionRegistry, DocumentInstanceResult } from './action-registry';
import { formatLinesText, formatNotesText } from './email-text';
import {
  registerEmailRecipientDefaultFromClient,
  registerEmailSendAction,
  registerSaveDraftAction,
} from './generic-actions';

export interface QuoteActionDeps {
  clientsService: ClientsService;
  mailService: MailService;
}

/**
 * Plain-text body for a quote's "send" email — presentational only: it lists the lines exactly as
 * entered, computes nothing (no total, no tax, no rounding rule). Those were the removed compliance
 * engine's job; this module describes a FORM, not fiscal or legal content. Exported so the live spec
 * (send-quote.live.spec.ts) exercises the exact same content-generation code the real handler below
 * uses, without needing a live database to get there.
 */
export function buildQuoteEmailText(document: Pick<DocumentInstanceResult, 'id' | 'data'>): string {
  const data = (document.data ?? {}) as Record<string, unknown>;
  return `Please find your quote (${document.id}) below.\n\n${formatLinesText(data)}${formatNotesText(data)}`;
}

/**
 * Registers the quote type's action IMPLEMENTATIONS. "save-draft" is the generic mechanism
 * (generic-actions.ts) shared with every document type; "send" is the QUOTE's OWN send-by-email
 * mechanism (generic-actions.ts's registerEmailSendAction/registerEmailRecipientDefaultFromClient —
 * see that file's comment for why this is no longer, and must not become again, shared with the
 * invoice). "convert-to-invoice" is implemented in its own file (actions/convert-to-invoice.ts,
 * registered alongside this one in documents.module.ts) rather than here, since it reads a quote's
 * shape and writes an invoice's — it belongs to neither type alone.
 */
export function registerQuoteActions(registry: ActionRegistry, deps: QuoteActionDeps): void {
  registerSaveDraftAction(registry, 'quote');
  registerEmailRecipientDefaultFromClient(registry, 'quote', deps.clientsService);
  registerEmailSendAction(registry, 'quote', 'Quote', buildQuoteEmailText, deps.mailService);
}
