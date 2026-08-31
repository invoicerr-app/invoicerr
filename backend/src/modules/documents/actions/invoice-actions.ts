import { NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import { upsertDocument } from '../persistence';
import { getCompanyInvoiceTransportId } from '../transports/company-transport';
import {
  DocumentTransport,
  TransportRegistry,
  UnknownTransportError,
} from '../transports/transport-registry';
import { ActionRegistry } from './action-registry';
import { registerSaveDraftAction } from './generic-actions';

export interface InvoiceActionDeps {
  transportRegistry: TransportRegistry;
}

/**
 * Registers the invoice type's action IMPLEMENTATIONS. "save-draft" is the exact same generic
 * mechanism the quote uses (generic-actions.ts) — persisting a draft's field values has nothing to do
 * with WHERE the document eventually travels, so sharing it is correct, unlike "send" below.
 *
 * "send" is DELIBERATELY NOT built on generic-actions.ts's registerSendAction/
 * registerSendRecipientDefaultFromClient — those are the quote's own send-by-email mechanism now
 * (see quote-actions.ts), not a shared one. An invoice's transport is a fact about the ISSUING
 * COMPANY, never about the invoice's country or the buyer's: this handler reads
 * `Company.invoiceTransportId` and asks TransportRegistry for whatever the company chose. Two
 * outcomes are deliberately treated as the SAME kind of failure as an action with no implementation
 * at all (a clear 501, never a silent fallback to email or anywhere else):
 *  - the company has not configured a transport yet (`invoiceTransportId` is null/empty);
 *  - the company configured one that is no longer registered (a plugin was removed, a typo).
 * Both cases mean "this invoice cannot actually be sent right now", which is exactly what 501 means
 * elsewhere in this module — see documents.service.ts's own NotImplementedException for an action
 * genuinely missing a handler. This handler IS registered (so DocumentsService finds it and validates
 * `data` before calling it); the block happens once inside it, deliberately worded so a user reads
 * WHY, the same discipline "record-payment" keeps proving for an action with no handler at all.
 *
 * "record-payment" stays declared on the descriptor (invoice.descriptor.ts) and deliberately NOT
 * registered here — reconciling a payment needs a ledger/accounting pipeline this branch does not
 * build, the same discipline "convert-to-invoice" used to hold the quote to before it was implemented
 * (see quote-actions.ts) — this is now the live case documents.service.invoice.spec.ts proves the
 * 501 mechanism against.
 */
export function registerInvoiceActions(registry: ActionRegistry, deps: InvoiceActionDeps): void {
  registerSaveDraftAction(registry, 'invoice');

  registry.register('invoice', 'send', async ({ companyId, documentId, data }) => {
    const transportId = await getCompanyInvoiceTransportId(companyId);
    if (!transportId) {
      logger.warn('Invoice "send" blocked: no transport configured for this company', {
        category: 'documents',
        details: { companyId },
      });
      throw new NotImplementedException(
        'No transport is configured for this company to send an invoice. ' +
          'Configure one in company settings before sending — there is no default channel.',
      );
    }

    let transport: DocumentTransport;
    try {
      transport = deps.transportRegistry.resolve(transportId);
    } catch (error) {
      if (error instanceof UnknownTransportError) {
        throw new NotImplementedException(
          `The transport "${transportId}" configured for this company is not available. ` +
            'Choose a different one in company settings before sending.',
        );
      }
      throw error;
    }

    const document = await upsertDocument(companyId, 'invoice', documentId, 'sent', data);
    // No pre-built `text` here anymore — the "email" transport (transports/email-transport.ts)
    // composes its own subject/body from invoice.descriptor.ts's `email` template (or a company
    // override) and attaches the PDF itself; see that file's own header and
    // actions/send-document-email.ts for the shared "compose + attach + send" mechanics. A
    // hypothetical transport that still wants plain text is free to build its own from `document`.
    const result = await transport.send({ companyId, document, label: 'Invoice' });

    return { document, changed: true, message: result.message };
  });
}
