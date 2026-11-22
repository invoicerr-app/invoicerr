import { ExtractedInvoiceFields } from './extraction';
import { reconcileSupplierClient, SupplierMatchResult } from './supplier-reconciliation';

/**
 * Runs supplier reconciliation on freshly extracted fields and returns them as the plain record the
 * create form reads, with `supplierClient` (a 'reference' field, see received-invoice.descriptor.ts)
 * filled in only when a client of THIS company matched. Shared by the upload preview
 * (`received-invoices.service.ts#upload`) and the queued OCR job (`ocr/run-ocr-job.ts`), so both
 * pre-fill the supplier the same way.
 *
 * Kept out of `supplier-reconciliation.ts` on purpose: the specs of both callers auto-mock that
 * module, which would also replace this helper and its call to `reconcileSupplierClient`.
 */
export async function withSupplierMatch(
  companyId: string,
  extractedFields: ExtractedInvoiceFields,
): Promise<{ fields: Record<string, unknown>; supplierMatch: SupplierMatchResult }> {
  const supplierMatch = await reconcileSupplierClient(companyId, {
    vatId: extractedFields.supplierVatId,
    supplierName: extractedFields.supplier,
  });
  const fields: Record<string, unknown> = { ...extractedFields };
  if (supplierMatch.outcome === 'matched') {
    fields.supplierClient = supplierMatch.clientId;
  }
  return { fields, supplierMatch };
}
