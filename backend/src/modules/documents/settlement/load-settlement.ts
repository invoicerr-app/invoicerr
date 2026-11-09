import type { DocumentInstanceResult } from '../actions/action-registry';
import type { DocumentTypeDescriptor } from '../descriptors/types';
import { resolveSettlementTotals } from '../totals/document-totals-view';
import { computeSettlement } from './compute-settlement';
import { resolveCreditsForDocument, toSettlementCreditInputs } from './credits';
import { listPayments, toSettlementPaymentInputs } from './payments';

export async function loadDocumentSettlement(
  companyId: string,
  descriptor: DocumentTypeDescriptor,
  instance: DocumentInstanceResult,
) {
  const data = instance.data as Record<string, unknown>;
  // Issue #487: a quote with options settles against its accepted option (common lines included),
  // never the sum of every option; with none accepted there is no balance to compute and this
  // refuses with 409 (`resolveSettlementTotals`'s own header says who can reach that).
  const totals = resolveSettlementTotals(
    descriptor.id,
    descriptor,
    data,
    instance.acceptedOption,
    instance.displayNumber ?? instance.id,
  );
  const payments = await listPayments(companyId, instance.id);
  const { credits, warnings } = await resolveCreditsForDocument(
    companyId,
    descriptor.id,
    instance.id,
    descriptor,
    data,
  );
  // `toSettlementPaymentInputs`, never the raw `payments` array directly:
  // since a payment can now be recorded in a currency other than the document's own (converted at
  // record time — settlement/convert-payment.ts), `computeSettlement` must read each payment's
  // `documentAmountMinor` (already in the document's own currency), not its own `amountMinor`
  // (the amount actually received, possibly in a different currency's minor units).
  const settlement = computeSettlement(
    totals.grossMinor,
    toSettlementPaymentInputs(payments),
    toSettlementCreditInputs(credits),
  );
  return { totals, payments, credits, warnings, settlement };
}
