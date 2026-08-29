import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { upsertDocument } from '../persistence';
import { ActionRegistry, DocumentInstanceResult } from './action-registry';

export interface QuoteActionDeps {
  clientsService: ClientsService;
  mailService: MailService;
}

interface QuoteLine {
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
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
  const currency = typeof data.currency === 'string' ? data.currency : '';
  const lines = Array.isArray(data.lines) ? (data.lines as QuoteLine[]) : [];

  const lineText = lines.length
    ? lines
        .map(
          (line) =>
            `  - ${line.description ?? ''}: ${line.quantity ?? ''} x ${line.unitPrice ?? ''} ${currency}`,
        )
        .join('\n')
    : '  (no lines)';

  const notes = typeof data.notes === 'string' && data.notes.length > 0 ? `\n\nNotes: ${data.notes}` : '';

  return `Please find your quote (${document.id}) below.\n\n${lineText}${notes}`;
}

/**
 * Registers the quote type's action IMPLEMENTATIONS. "save-draft" and "send" are both implemented;
 * "convert-to-invoice" is declared on the descriptor (quote.descriptor.ts) but deliberately NOT
 * registered — the point of this registry is that a declared-but-unimplemented action is blocked
 * with a clear error (DocumentsService.runAction), never silently accepted or silently dropped, and
 * this is the live case that keeps proving it now that "send" no longer can.
 */
export function registerQuoteActions(registry: ActionRegistry, deps: QuoteActionDeps): void {
  registry.register('quote', 'save-draft', async ({ companyId, typeId, documentId, data }) => ({
    document: await upsertDocument(companyId, typeId, documentId, 'draft', data),
    changed: true,
  }));

  // Pre-fills "send"'s `recipient` param from the currently-selected client's contact email — the
  // mechanism (ActionRegistry.registerParamsDefaults) is fully generic; only this lookup is
  // quote-specific. `data.client` is the id stored by the 'reference' field, not yet an email.
  registry.registerParamsDefaults('quote', 'send', async ({ companyId, data }) => {
    const clientId = typeof data.client === 'string' ? data.client : undefined;
    if (!clientId) return {};
    const client = await deps.clientsService.getClientById(companyId, clientId);
    return client?.contactEmail ? { recipient: client.contactEmail } : {};
  });

  registry.register('quote', 'send', async ({ companyId, typeId, documentId, data, params }) => {
    // `params.recipient` is already validated (required, non-empty text) by DocumentsService.runAction
    // before this handler ever runs — same trust boundary "save-draft" already has for `data`.
    const recipient = params.recipient as string;
    const document = await upsertDocument(companyId, typeId, documentId, 'sent', data);

    await deps.mailService.sendMail({
      to: recipient,
      subject: `Quote ${document.id}`,
      text: buildQuoteEmailText(document),
    });

    return { document, changed: true, message: `Quote sent to ${recipient}.` };
  });
}
