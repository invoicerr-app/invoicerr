import { ActionRegistry } from './action-registry';
import { findOwnedDocument, upsertDocument } from '../persistence';

/**
 * Implements the quote's "convert-to-invoice" action — declared on quote.descriptor.ts since the
 * type's own inception, deliberately left unregistered until now (see quote-actions.ts's own comment
 * on why: it was the live case documents.service.spec.ts used to prove a declared-but-unimplemented
 * action is BLOCKED, not silently ignored). That role now belongs to the invoice's "record-payment"
 * (documents.service.invoice.spec.ts) — this file is what makes "convert-to-invoice" stop needing to
 * play it.
 *
 * Creates a brand-new INVOICE draft from the quote's current data, and records the link back with the
 * multi-target `origin` reference (invoice.descriptor.ts) — `{ entity: 'quote', id: quote.id }`, not
 * a bare id, which is exactly the shape that field needed multi-target 'reference' support for
 * (types.ts's MultiTargetReferenceValue).
 *
 * Deliberately in its own file rather than quote-actions.ts or invoice-actions.ts: it belongs to
 * neither type alone — it is the one place that reads a quote's shape AND writes an invoice's, which
 * would make it an awkward fit either way.
 *
 * What is carried over, and what is not:
 *  - `client`, `currency`, `notes`, `lines`: copied verbatim — both descriptors give these fields the
 *    exact same kind and meaning (see invoice.descriptor.ts's header comment), so there is nothing to
 *    translate.
 *  - `issueDate`: set to TODAY, not the quote's own issue date — the invoice is issued the day it is
 *    actually raised, which is the moment this handler runs, not whenever the quote happened to be
 *    written.
 *  - `dueDate`: deliberately left UNSET. A quote's due date is an optional validity window; an
 *    invoice's is its payment deadline — two different things this handler has no basis to invent a
 *    value for. The invoice descriptor requires it, but this call bypasses that descriptor's
 *    validation entirely (see below), so an unset `dueDate` here means exactly what it should: a
 *    draft the user still has to finish, the same way "duplicate" (duplicate-extension.ts) can clone
 *    a record without DocumentsService.runAction ever re-validating the copy.
 *
 * Bypasses validateAgainstDescriptor for the CREATED invoice on purpose: DocumentsService.runAction
 * only ever validates `payload.data` against the ACTING type's own descriptor (here, the quote's) —
 * a handler that persists a DIFFERENT type's instance, as this one does, was never going to be
 * validated against the target's rules by that mechanism, and duplicate-extension.ts already
 * established that a freshly-created draft is allowed to need finishing before it can be acted on
 * again (any later action against it DOES validate against the invoice descriptor as normal).
 */
export function registerConvertToInvoiceAction(registry: ActionRegistry): void {
  registry.register('quote', 'convert-to-invoice', async ({ companyId, documentId }) => {
    if (!documentId) {
      // Unreachable in practice — the descriptor's `availableWhen: ['draft', 'sent']` already
      // refuses this before the handler runs (a never-saved record has no status to match) — but a
      // handler never trusts that alone, the same discipline duplicate-extension.ts documents.
      throw new Error('Cannot convert a quote that has not been saved yet.');
    }

    const quote = await findOwnedDocument(companyId, 'quote', documentId);
    const quoteData = (quote.data ?? {}) as Record<string, unknown>;

    const invoiceData: Record<string, unknown> = {
      client: quoteData.client,
      issueDate: new Date().toISOString(),
      currency: quoteData.currency,
      notes: quoteData.notes,
      lines: quoteData.lines,
      origin: { entity: 'quote', id: quote.id },
    };

    const invoice = await upsertDocument(companyId, 'invoice', undefined, 'draft', invoiceData);

    return {
      document: invoice,
      changed: true,
      message: `Invoice ${invoice.id} created from quote ${quote.id}.`,
    };
  });
}
