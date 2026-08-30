import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { ActionRegistry, DocumentInstanceResult } from './action-registry';
import { formatLinesText, formatNotesText } from './email-text';
import {
  registerSaveDraftAction,
  registerSendAction,
  registerSendRecipientDefaultFromClient,
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
 * Registers the quote type's action IMPLEMENTATIONS. "save-draft" and "send" are both implemented,
 * built on the generic save/send mechanism (generic-actions.ts) now shared with the invoice type —
 * this file supplies only what is genuinely quote-specific: the email body. "convert-to-invoice" is
 * declared on the descriptor (quote.descriptor.ts) but deliberately NOT registered — the point of
 * this registry is that a declared-but-unimplemented action is blocked with a clear error
 * (DocumentsService.runAction), never silently accepted or silently dropped, and this is the live
 * case that keeps proving it now that "send" no longer can.
 */
export function registerQuoteActions(registry: ActionRegistry, deps: QuoteActionDeps): void {
  registerSaveDraftAction(registry, 'quote');
  registerSendRecipientDefaultFromClient(registry, 'quote', deps.clientsService);
  registerSendAction(registry, 'quote', 'Quote', buildQuoteEmailText, deps.mailService);
}
