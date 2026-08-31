import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { decimalsFor, toMinor } from '@/utils/financial';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { findOwnedDocument } from '../persistence';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { computeSettlement, describeSettlement } from '../settlement/compute-settlement';
import { resolveCreditsForDocument, toSettlementCreditInputs } from '../settlement/credits';
import { listPayments, recordPayment } from '../settlement/payments';
import { computeDocumentTotals } from '../totals/compute-totals';
import { getCompanyInvoiceTransportId } from '../transports/company-transport';
import {
  DocumentTransport,
  TransportRegistry,
  UnknownTransportError,
} from '../transports/transport-registry';
import { runAsyncSendAction } from './async-send';
import { ActionRegistry } from './action-registry';
import { registerSaveDraftAction } from './generic-actions';

export interface InvoiceActionDeps {
  transportRegistry: TransportRegistry;
  queueDispatcher: DocumentActionQueueDispatcher;
}

/**
 * Resolves the ISSUING COMPANY's own configured transport, or throws the exact 501 this action
 * always has for "no transport" / "an unknown one" — shared between the two moments this now runs at
 * (see `registerInvoiceActions`'s own header): the phase-1 PREFLIGHT check (so a doomed send is
 * refused before anything is persisted or queued, never a job enqueued only to fail immediately) and
 * `deliver()` itself (re-resolved there too — the company's configuration could have changed between
 * the two calls, which a job replayed later must still honor, not a value cached from the first one).
 */
async function resolveInvoiceTransport(
  transportRegistry: TransportRegistry,
  companyId: string,
): Promise<DocumentTransport> {
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

  try {
    return transportRegistry.resolve(transportId);
  } catch (error) {
    if (error instanceof UnknownTransportError) {
      throw new NotImplementedException(
        `The transport "${transportId}" configured for this company is not available. ` +
          'Choose a different one in company settings before sending.',
      );
    }
    throw error;
  }
}

/**
 * The invoice's OWN base descriptor, imported directly here rather than resolved through
 * `DocumentTypeRegistry` — deliberate, and only defensible because this file is ALREADY 100%
 * invoice-specific (every handler below hardcodes `'invoice'` as the typeId; unlike
 * generic-actions.ts, nothing here is meant to be reused by another type). It exists purely to feed
 * `computeDocumentTotals` the field SHAPE it needs to find the invoice's own `lines`/`currency` —
 * exactly the same shape `documents.service.ts`'s own `computeTotals` endpoint already uses (that one
 * reads the MERGED descriptor — native + third-party action extensions — which never touches invoice
 * FIELDS either, so this is no less faithful). Country field overlays are a no-op for every shipped
 * country today (country-fields/data/all.ts ships none) — the day one exists for the invoice, this is
 * the one spot that would need to start asking `DocumentTypeRegistry` instead.
 */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/**
 * Registers the invoice type's action IMPLEMENTATIONS. "save-draft" is the exact same generic
 * mechanism the quote uses (generic-actions.ts) — persisting a draft's field values has nothing to do
 * with WHERE the document eventually travels, so sharing it is correct, unlike "send" below.
 *
 * "send" is DELIBERATELY NOT the quote's own send-by-email mechanism (quote-actions.ts) — an
 * invoice's transport is a fact about the ISSUING COMPANY, never about the invoice's country or the
 * buyer's: `resolveInvoiceTransport` above reads `Company.invoiceTransportId` and asks
 * TransportRegistry for whatever the company chose. Two outcomes are deliberately treated as the SAME
 * kind of failure as an action with no implementation at all (a clear 501, never a silent fallback to
 * email or anywhere else):
 *  - the company has not configured a transport yet (`invoiceTransportId` is null/empty);
 *  - the company configured one that is no longer registered (a plugin was removed, a typo).
 * Both cases mean "this invoice cannot actually be sent right now", which is exactly what 501 means
 * elsewhere in this module — see documents.service.ts's own NotImplementedException for an action
 * genuinely missing a handler. This handler IS registered (so DocumentsService finds it and validates
 * `data` before calling it); the block happens once inside it, deliberately worded so a user reads
 * WHY, the same discipline "export-accounting" now keeps proving for an action with no handler at all
 * (see invoice.descriptor.ts's own header — that role used to belong to "record-payment").
 *
 * As of TODO.md item 22, "send" is ASYNCHRONOUS — built on `runAsyncSendAction` (actions/async-send.ts),
 * the same two-phase engine the quote's and the credit note's own "send" use. The transport check
 * above becomes this action's `preflight`: it still runs BEFORE the record ever moves to "sending" and
 * BEFORE anything is queued, so an unconfigured company still gets an immediate 501 with nothing
 * persisted — exactly the behavior this action had before it became asynchronous. `deliver()`
 * re-resolves the transport rather than closing over the preflight's result: the two calls can be
 * seconds (or, after a retry, much longer) apart, and a job replayed later must honor whatever the
 * company's configuration says AT THAT TIME, not a value cached from when it was first enqueued.
 *
 * "record-payment" IS registered below — see its own comment for the currency/amount guards and what
 * it hands back. "export-accounting" stays declared on the descriptor (invoice.descriptor.ts) and
 * deliberately NOT registered here: a real accounting export needs a chart-of-accounts mapping and a
 * ledger format this branch does not build, the same discipline "record-payment" used to hold before
 * this task, and "convert-to-invoice" held the quote to before IT was implemented (see
 * quote-actions.ts) — this is now the live case documents.service.invoice.spec.ts proves the 501
 * mechanism against.
 */
export function registerInvoiceActions(registry: ActionRegistry, deps: InvoiceActionDeps): void {
  registerSaveDraftAction(registry, 'invoice');

  registry.register('invoice', 'send', async ({ companyId, documentId, data, params }) =>
    runAsyncSendAction({
      companyId,
      typeId: 'invoice',
      documentId,
      data,
      params,
      queueDispatcher: deps.queueDispatcher,
      numberOnEnqueue: true, // invoice.descriptor.ts: numbering.onEnterStatus === 'sending'
      preflight: async () => {
        const transport = await resolveInvoiceTransport(deps.transportRegistry, companyId);
        // See `DocumentTransport.preflight`'s own header: an EXTRA, transport-owned readiness check
        // (e.g. "pdp": are credentials actually connected?) the registry lookup above cannot see —
        // absent for a transport with nothing to check ahead of time (e.g. "email").
        await transport.preflight?.(companyId);
      },
      // No pre-built `text` here — the "email" transport (transports/email-transport.ts) composes
      // its own subject/body from invoice.descriptor.ts's `email` template (or a company override)
      // and attaches the PDF itself; see that file's own header and actions/send-document-email.ts
      // for the shared "compose + attach + send" mechanics. A hypothetical transport that still wants
      // plain text is free to build its own from `document`.
      deliver: async ({ companyId: c, document }) => {
        const transport = await resolveInvoiceTransport(deps.transportRegistry, c);
        return transport.send({ companyId: c, document, label: 'Invoice' });
      },
    }),
  );

  // "recipient" defaults from the client (registerEmailRecipientDefaultFromClient, quote-actions.ts)
  // is the model for this: a best-effort pre-fill, read from the CURRENT record, never required for
  // the action to be usable at all (a resolver failing to run still opens the dialog, just empty).
  // Here it pre-fills `paidAt` with TODAY and `currency` with the invoice's OWN currency — the second
  // one is not a declared `param` a user fills in from nothing, it is what makes the `amount` field's
  // `currencyField: 'currency'` (invoice.descriptor.ts) show the right symbol from the moment the
  // dialog opens, without the invoice's `data` ever being reachable from the params dialog's own,
  // separate form.
  registry.registerParamsDefaults('invoice', 'record-payment', async ({ companyId, documentId }) => {
    if (!documentId) return {};
    const document = await findOwnedDocument(companyId, 'invoice', documentId);
    const currency = (document.data as Record<string, unknown> | null)?.currency;
    return {
      paidAt: new Date().toISOString(),
      ...(typeof currency === 'string' ? { currency } : {}),
    };
  });

  /**
   * Records a payment against an ALREADY-SENT invoice (availableWhen: ['sent'] — see
   * invoice.descriptor.ts) and hands back the invoice's up-to-date BALANCE. Three guards, in order:
   *  - `amount` must be strictly positive — `min` is deliberately NOT set on the field descriptor
   *    (which would only ever enforce `>= 0`, letting a bare 0 through as "structurally valid"); this
   *    handler is the one place that enforces the actual business rule, with one clear message;
   *  - `currency` must equal the invoice's own — no conversion (see this file's own header, and
   *    compute-settlement.ts's header on why a payment never silently changes the claim's own
   *    currency). Read off the PERSISTED document (`findOwnedDocument`), never the client-submitted
   *    `data`: the params-defaults resolver above pre-fills the params dialog's `currency` from the
   *    same source, but nothing stops a scripted client from posting a different one directly — the
   *    same "the API refuses exactly what the screen would refuse" discipline documents.service.ts's
   *    own `runAction` holds for country policy and status.
   *  - implicitly, `documentId` must exist: unreachable in practice (a never-saved record has no
   *    status for `availableWhen: ['sent']` to match) but never trusted alone — the same defensive
   *    posture "delete" (generic-actions.ts) already holds for the same shape of guarantee.
   *
   * Deliberately does NOT call `upsertDocument`: a payment does not change the invoice's own field
   * values or status (see invoice.descriptor.ts's lifecycle comment on why no `transitions` are
   * declared here) — `result.document` is the SAME, unchanged, freshly-read instance, which is also
   * exactly what `checkTransitionResult` (lifecycle.ts) expects for an action with no declared
   * transitions: whatever status it already was.
   */
  registry.register('invoice', 'record-payment', async ({ companyId, documentId, params }) => {
    if (!documentId) {
      throw new Error('Cannot record a payment on an invoice that has not been saved yet.');
    }

    const document = await findOwnedDocument(companyId, 'invoice', documentId);
    const documentData = (document.data ?? {}) as Record<string, unknown>;
    const documentCurrency = typeof documentData.currency === 'string' ? documentData.currency : undefined;
    if (!documentCurrency) {
      throw new BadRequestException(
        `Invoice "${documentId}" has no currency recorded — cannot record a payment against it.`,
      );
    }

    const amount = params.amount as number; // already proven a finite number by the 'money' kind.
    if (!(amount > 0)) {
      throw new BadRequestException('The payment amount must be greater than zero.');
    }

    const paymentCurrency = typeof params.currency === 'string' ? params.currency : documentCurrency;
    if (paymentCurrency !== documentCurrency) {
      throw new BadRequestException(
        `The payment currency ("${paymentCurrency}") does not match this invoice's own currency ` +
          `("${documentCurrency}") — recording a payment in a different currency isn't supported yet.`,
      );
    }

    const paidAt = typeof params.paidAt === 'string' ? new Date(params.paidAt) : new Date();
    const method = typeof params.method === 'string' ? params.method : undefined;
    const note = typeof params.note === 'string' ? params.note : undefined;

    await recordPayment({
      companyId,
      documentId,
      amountMinor: toMinor(amount, documentCurrency),
      currency: documentCurrency,
      method,
      paidAt,
      note,
    });

    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, documentData);
    const payments = await listPayments(companyId, documentId);
    // CREDITS count towards this same balance (item 8, "le lettrage") — resolved here too, not just
    // in documents.service.ts's own GET .../settlement, so the balance THIS message states (and the
    // "settled" fact logged below) never contradicts what a follow-up read of the settlement screen
    // shows: an invoice already partly credited before this payment must not be reported as owing
    // more than it actually does.
    const { credits } = await resolveCreditsForDocument(
      companyId,
      'invoice',
      documentId,
      INVOICE_DESCRIPTOR,
      documentData,
    );
    const settlement = computeSettlement(totals.grossMinor, payments, toSettlementCreditInputs(credits));

    logger.info('Payment recorded against an invoice', {
      category: 'documents',
      details: {
        companyId,
        documentId,
        amountMinor: toMinor(amount, documentCurrency),
        currency: documentCurrency,
        decimals: decimalsFor(documentCurrency),
        settled: settlement.settled,
      },
    });

    return {
      document,
      changed: true,
      message: describeSettlement(settlement, documentCurrency),
    };
  });
}
