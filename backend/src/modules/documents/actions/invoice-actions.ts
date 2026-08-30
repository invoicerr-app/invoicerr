import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { ActionRegistry, DocumentInstanceResult } from './action-registry';
import { formatLinesText, formatNotesText } from './email-text';
import {
  registerSaveDraftAction,
  registerSendAction,
  registerSendRecipientDefaultFromClient,
} from './generic-actions';

export interface InvoiceActionDeps {
  clientsService: ClientsService;
  mailService: MailService;
}

/**
 * Plain-text body for an invoice's "send" email — presentational only, exactly like the quote's (see
 * buildQuoteEmailText in quote-actions.ts): it lists the lines and notes exactly as entered,
 * computes nothing (no total, no tax, no rounding rule, no due-date reminder wording). Exported for
 * the same reason buildQuoteEmailText is: a future live spec could exercise this exact
 * content-generation code without a live database, the way send-quote.live.spec.ts already does for
 * the quote.
 */
export function buildInvoiceEmailText(document: Pick<DocumentInstanceResult, 'id' | 'data'>): string {
  const data = (document.data ?? {}) as Record<string, unknown>;
  return `Please find your invoice (${document.id}) below.\n\n${formatLinesText(data)}${formatNotesText(data)}`;
}

/**
 * Registers the invoice type's action IMPLEMENTATIONS, built on the exact same generic save/send
 * mechanism the quote uses (actions/generic-actions.ts) — nothing here is a second copy of that
 * plumbing, only what is genuinely invoice-specific: the email body. "record-payment" is declared on
 * the descriptor (invoice.descriptor.ts) but deliberately NOT registered here — reconciling a
 * payment needs a ledger/accounting pipeline this branch does not build, the same discipline
 * "convert-to-invoice" holds the quote to (see quote-actions.ts).
 */
export function registerInvoiceActions(registry: ActionRegistry, deps: InvoiceActionDeps): void {
  registerSaveDraftAction(registry, 'invoice');
  registerSendRecipientDefaultFromClient(registry, 'invoice', deps.clientsService);
  registerSendAction(registry, 'invoice', 'Invoice', buildInvoiceEmailText, deps.mailService);
}
