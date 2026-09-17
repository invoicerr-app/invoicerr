import { BadRequestException } from '@nestjs/common';

import { toMinor } from '@/utils/financial';

import { findOwnedDocument, updateDocumentStatus, upsertDocument } from '../persistence';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { checkReceivedInvoiceLineTotals } from '../received-invoices/line-totals-check';
import { markClientAsSupplier } from '../received-invoices/supplier-reconciliation';
import { listPayments, recordPayment, toSettlementPaymentInputs } from '../settlement/payments';
import { PdpReceptionStatusPusher } from '../transports/pdp/pdp-reception';
import { ActionRegistry } from './action-registry';
import { registerDeleteAction } from './generic-actions';

/**
 * Registers the "received-invoice" type's action IMPLEMENTATIONS. Four bespoke
 * handlers plus one reused generic one, none of them touching a transport, a queue, or an email —
 * this type is never SENT anywhere (see received-invoice.descriptor.ts's own header). "record-payment"
 * is the exception to "never touches a transport": it does not deliver anything itself, but — like
 * "approve"/"reject" — it CAN reach out to PDP, one-way, best-effort, to report a buyer-side lifecycle
 * status back to the platform a PDP-sourced deposit actually came from (`pdpStatusPusher`, below).
 *
 * `webhooks` only reaches the generic "delete" below — "receive" (this
 * type's OWN create/edit action, not `registerSaveDraftAction`) deliberately does NOT dispatch
 * `DOCUMENT_CREATED` here: `DOCUMENT_RECEIVED` is the honest event for an
 * inbound deposit, and wiring `DOCUMENT_CREATED` here too, ahead of that decision, would give a
 * receiver two different "this arrived" signals for the same fact.
 *
 * `pdpStatusPusher` (`transports/pdp/pdp-reception.ts#PdpReceptionStatusPusher`) is OPTIONAL and
 * narrow-interfaced on purpose — the same "depend on the interface, not the concrete class" discipline
 * `webhooks` above already holds: every EXISTING jest spec constructs this registry without one, and a
 * record with no `data.pdpInboundId` (every manually-uploaded received-invoice, and any before this
 * feature existed) simply never triggers a push at all — the pusher itself already no-ops on a
 * non-numeric id (see that file's own header), this is belt-and-suspenders at the call site too:
 * nothing here even ATTEMPTS a push without a `pdpInboundId` string in hand first.
 */
export function registerReceivedInvoiceActions(
  registry: ActionRegistry,
  webhooks?: DocumentWebhookEmitter,
  pdpStatusPusher?: PdpReceptionStatusPusher,
): void {
  // Same "pre-fill paidAt/currency" resolver `invoice-actions.ts`'s own "record-payment" already
  // registers, for the identical reason: `paidAt`/`currency` are both `required: true`
  // (RECORD_PAYMENT_PARAMS, received-invoice.descriptor.ts) — without a default, the params dialog
  // opens with both empty and client-side validation refuses to submit at all, no matter what the
  // user types into `amount`. A best-effort pre-fill (this resolver failing still opens the dialog,
  // just empty) is not required for the action to be usable, only for it to be usable WITHOUT first
  // retyping two fields the record already answers for itself.
  registry.registerParamsDefaults('received-invoice', 'record-payment', async ({ companyId, documentId }) => {
    if (!documentId) return {};
    const document = await findOwnedDocument(companyId, 'received-invoice', documentId);
    const currency = (document.data as Record<string, unknown> | null)?.currency;
    return {
      paidAt: new Date().toISOString(),
      ...(typeof currency === 'string' ? { currency } : {}),
    };
  });

  /**
   * "receive": this type's create/edit action — the same role `registerSaveDraftAction`
   * (generic-actions.ts) plays for every other type, NOT reused verbatim because that helper
   * hardcodes the status "draft" (see its own header) — this type has no "draft" status at all (see
   * the descriptor's own header on why "received" is the initial status). Persists whatever `data`
   * the caller sent, including the `fileRef`/`fileName`/`fileMime` keys the upload flow
   * (received-invoices/received-invoices.service.ts) and the frontend's own upload dialog seed into
   * it — those three keys are not declared `DocumentFieldDescriptor`s (see the descriptor's own
   * header on why), so `validateAgainstDescriptor` never touches them, but `upsertDocument` persists
   * `data` whole, exactly the same way it already does for every other type's own declared fields.
   * `pdpInboundId`/`pdpProviderId` (the reception sweep's own reserved keys,
   * `conformity/reception-sweep-runner.ts`) ride along the exact same, unchanged way.
   *
   * Also computes `lineTotalWarnings` (received-invoices/line-totals-check.ts)
   * and writes it into `data` under that same reserved-key convention: an array, possibly empty, of
   * NAMED warnings when the lines' own sum disagrees with the flat `netAmount`/`vatAmount`/
   * `grossAmount` beyond rounding tolerance. Recomputed on EVERY save (this action is the type's only
   * create/edit path), so editing a line — or the stated totals — always leaves the persisted warning
   * in sync with what was just saved; STORED, not recomputed on every read, which is what makes the
   * warning "carried by the document" (visible again on a later GET, the list, the detail screen)
   * without a second generic mechanism reading `lines` on every fetch.
   *
   * Also the ONLY point that turns a supplier LINK into a persisted role:
   * when `data.supplierClient` (the 'reference' field, entity "supplier" — see the descriptor's own
   * header) names a client, that Client is marked `isSupplier: true`
   * (`received-invoices/supplier-reconciliation.ts#markClientAsSupplier`) — whether the link came from
   * upload-time auto-reconciliation (`received-invoices.service.ts#upload`, pre-filling this very
   * field), the reception sweep's OWN auto-reconciliation, or from the user picking one by hand: all
   * three converge on this ONE handler, so all three mark the role the same way. Never called when the
   * field is empty — a received invoice with no linked supplier touches no Client at all.
   */
  registry.register('received-invoice', 'receive', async ({ companyId, documentId, data }) => {
    const lineTotalWarnings = checkReceivedInvoiceLineTotals(data);
    const dataWithWarnings = { ...data, lineTotalWarnings };
    // `fromStatuses: ['received']` — every shipped country's own `receive` rule (country-policy/data/
    // *.json) narrows re-editing this same way and for the same reason ("once approved or rejected,
    // the review decision must no longer be silently undone by a new field save"), but that narrowing
    // is itself just an earlier, separate read: a "receive" edit racing a concurrent "approve"/"reject"
    // could otherwise still land AFTER the review decision and silently reset the status back to
    // "received", undoing it. Ignored on the create path just below (`documentId` undefined — nothing
    // to compare against yet), the same "fromStatuses is a no-op for a genuinely new row" contract
    // `upsertDocument` (persistence.ts) already documents.
    const document = await upsertDocument(
      companyId,
      'received-invoice',
      documentId,
      'received',
      dataWithWarnings,
      ['received'],
    );

    const supplierClientId = typeof data.supplierClient === 'string' ? data.supplierClient : undefined;
    if (supplierClientId) {
      await markClientAsSupplier(companyId, supplierClientId);
    }

    return { document, changed: true };
  });

  /**
   * "approve"/"reject": plain, terminal status transitions — no data effect on THIS record beyond
   * "reject"'s own `rejectionReason` (below), mirroring credit-note-actions.ts's own "send" in spirit
   * (a status change and nothing else) but even simpler: not even asynchronous (there is nothing to
   * deliver, ever, for this type), so this reuses `updateDocumentStatus` (persistence.ts) directly
   * rather than `runAsyncSendAction`. Both are only ever reachable once a record already exists
   * (`availableWhen: ['received']` on the descriptor), so `documentId` is always defined here — the
   * guard below is the same defensive posture `generic-actions.ts`'s own `registerDeleteAction`
   * documents for the identical, structurally unreachable case.
   *
   * Both ALSO push a buyer-side lifecycle status back to PDP when this record actually came from
   * there (`data.pdpInboundId`, set by the reception sweep — `conformity/reception-sweep-runner.ts`)
   * — best-effort, see `pdpStatusPusher`'s own header above: a push failure NEVER undoes or blocks the
   * local status change, which is already persisted by the time the push is even attempted.
   */
  registry.register('received-invoice', 'approve', async ({ companyId, documentId }) => {
    if (!documentId) {
      throw new Error('Cannot approve a "received-invoice" document that has not been saved yet.');
    }
    // `fromStatuses: ['received']` (APPROVE_TRANSITIONS) — two concurrent "approve" clicks (or an
    // "approve" racing a "reject" on the same record) would otherwise both pass the earlier
    // `availableWhen: ['received']` read and both commit, each pushing its OWN "approved" status to
    // PDP for the same deposit. The compare-and-swap lets only the first through; the second gets a
    // named 409 before `pdpStatusPusher` is ever reached.
    const document = await updateDocumentStatus(
      companyId,
      'received-invoice',
      documentId,
      'approved',
      null,
      undefined,
      undefined,
      ['received'],
    );

    const pdpInboundId = readPdpInboundId(document.data);
    if (pdpInboundId) {
      await pdpStatusPusher?.pushApproved(companyId, pdpInboundId);
    }

    return { document, changed: true, message: 'Approved.' };
  });

  registry.register('received-invoice', 'reject', async ({ companyId, documentId, params }) => {
    if (!documentId) {
      throw new Error('Cannot reject a "received-invoice" document that has not been saved yet.');
    }
    // Already proven a non-empty string by the descriptor's own `params` validation
    // (REJECT_PARAMS: `reason` is `required: true`) before this handler ever runs — read defensively
    // regardless, the same "the handler never trusts a gate it did not itself run" posture this
    // module's every other action already holds.
    const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
    if (!reason) {
      throw new BadRequestException('A rejection reason is required.');
    }

    const existing = await findOwnedDocument(companyId, 'received-invoice', documentId);
    const mergedData = { ...(existing.data as Record<string, unknown> | null), rejectionReason: reason };
    // `fromStatuses: ['received']` (REJECT_TRANSITIONS) — `mergedData` above was computed from
    // `existing`, read a moment ago: an "approve" (or another "reject") that commits in the gap would
    // otherwise be silently overwritten by THIS write, which carries none of it — not just the
    // rejection reason, the entire record reverts to whatever `existing` looked like before the other
    // call's own change. Folding the guard into this SAME write (rather than a second, separate
    // status-only call) is what makes it atomic: either this exact `mergedData` — reason included —
    // lands in one write, or the whole thing 409s and nothing is persisted.
    const document = await upsertDocument(companyId, 'received-invoice', documentId, 'rejected', mergedData, [
      'received',
    ]);

    const pdpInboundId = readPdpInboundId(document.data);
    if (pdpInboundId) {
      await pdpStatusPusher?.pushRejected(companyId, pdpInboundId, reason);
    }

    return { document, changed: true, message: 'Rejected.' };
  });

  /**
   * "record-payment" — this company recording money IT sent to the SUPPLIER, the mirror of
   * `invoice-actions.ts`'s own "record-payment" (money a CLIENT sent to this company). Reuses the
   * exact same `DocumentPayment` model and persistence (`settlement/payments.ts`) — that module is not
   * scoped to any one document type — with two deliberate simplifications from the invoice's own
   * version (see `RECORD_PAYMENT_PARAMS`'s own header in the descriptor for why): no cross-currency
   * conversion (a mismatch is refused outright, never converted), and no credit-note-style settlement
   * — "paid" here means "the sum of recorded payments has reached this record's own stated
   * `grossAmount`", nothing more granular.
   *
   * Deliberately does NOT call `upsertDocument`: a payment does not change the received-invoice's own
   * field values or status (`availableWhen: ['approved']` on the descriptor, no `transitions`
   * declared) — the same "the handler's own result is the SAME, unchanged instance" contract
   * `invoice-actions.ts`'s own "record-payment" already documents.
   *
   * Pushes PDP's own "payée" buyer status (`fr:211`, "payment sent" — this company IS the buyer here)
   * the FIRST pass this payment reaches full settlement — computed by comparing the sum WITH vs.
   * WITHOUT the payment this call just inserted, the identical "no separate 'before' query, no race
   * window" technique `invoice-actions.ts`'s own `crossedIntoSettled` check already uses for
   * `DOCUMENT_SETTLED`.
   */
  registry.register('received-invoice', 'record-payment', async ({ companyId, documentId, params }) => {
    if (!documentId) {
      throw new Error(
        'Cannot record a payment on a "received-invoice" document that has not been saved yet.',
      );
    }

    const document = await findOwnedDocument(companyId, 'received-invoice', documentId);
    const documentData = (document.data ?? {}) as Record<string, unknown>;
    const documentCurrency = typeof documentData.currency === 'string' ? documentData.currency : undefined;
    if (!documentCurrency) {
      throw new BadRequestException(
        `Received invoice "${documentId}" has no currency recorded — cannot record a payment against it.`,
      );
    }
    const grossAmount = typeof documentData.grossAmount === 'number' ? documentData.grossAmount : undefined;

    const amount = params.amount as number; // already proven a finite number by the 'money' kind.
    if (!(amount > 0)) {
      throw new BadRequestException('The payment amount must be greater than zero.');
    }

    const paymentCurrency = typeof params.currency === 'string' ? params.currency : documentCurrency;
    if (paymentCurrency !== documentCurrency) {
      // See this action's own header — deliberately no conversion, unlike invoice-actions.ts's own
      // "record-payment": a real need for cross-currency supplier payments can revisit this.
      throw new BadRequestException(
        `The payment currency ("${paymentCurrency}") does not match this received invoice's own ` +
          `currency ("${documentCurrency}") — recording it would silently misstate what was actually ` +
          'paid, so it is refused instead.',
      );
    }

    const paidAt = typeof params.paidAt === 'string' ? new Date(params.paidAt) : new Date();
    const amountMinor = toMinor(amount, paymentCurrency);
    const method = typeof params.method === 'string' ? params.method : undefined;
    const note = typeof params.note === 'string' ? params.note : undefined;

    const paymentsBefore = await listPayments(companyId, documentId);
    const paidBefore = sumMinor(toSettlementPaymentInputs(paymentsBefore));

    const newPayment = await recordPayment({
      companyId,
      documentId,
      amountMinor,
      currency: paymentCurrency,
      documentAmountMinor: amountMinor, // same currency, always — see the refusal above.
      method,
      paidAt,
      note,
    });

    const paidAfter = paidBefore + amountMinor;
    const grossMinor = grossAmount !== undefined ? toMinor(grossAmount, documentCurrency) : undefined;
    const justSettled = grossMinor !== undefined && paidBefore < grossMinor && paidAfter >= grossMinor;

    const pdpInboundId = readPdpInboundId(documentData);
    if (justSettled && pdpInboundId) {
      await pdpStatusPusher?.pushPaid(companyId, pdpInboundId);
    }

    return {
      document,
      changed: true,
      createdPaymentId: newPayment.id,
      message: justSettled ? 'Payment recorded — fully settled.' : 'Payment recorded.',
    };
  });

  // See the descriptor's own header on why this is restricted to "received" only — the same
  // mechanism `expense-actions.ts` already registers, applied to a narrower `availableWhen`.
  registerDeleteAction(registry, 'received-invoice', webhooks);
}

/** `data.pdpInboundId` when this record actually came from the PDP reception sweep, undefined for a
 *  manually-uploaded one — the SAME reserved-key convention `fileRef`/`fileName`/`fileMime` already
 *  hold (see the descriptor's own header), shared by every handler above that may push a status. */
function readPdpInboundId(data: unknown): string | undefined {
  const value = (data as Record<string, unknown> | null | undefined)?.pdpInboundId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sumMinor(inputs: readonly { amountMinor: number }[]): number {
  return inputs.reduce((total, input) => total + input.amountMinor, 0);
}
