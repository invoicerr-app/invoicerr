/**
 * Every row-level reason a vendor export reader can give, as an i18n key plus its values. The
 * sentences themselves live in `frontend/src/locales/en/translation.json` under `imports.vendor.*`,
 * so the preview follows the interface language instead of printing English into a French screen.
 *
 * A whole-file refusal (`VendorExportMappingError`) stays a plain English `BadRequestException`
 * message: it names a missing column on the file the user picked, and no row is shown for it.
 */
import { VendorRowError } from './vendor-export.types';

/** One key per row reason; the union is what keeps a producer from inventing a name. */
export type VendorRowMessageId =
  | 'clientNoName'
  | 'companyNoName'
  | 'invoiceNumberEmpty'
  | 'clientNameEmpty'
  | 'invalidIssueDate'
  | 'invalidDueDate'
  | 'invalidVatRate'
  | 'vatRateMissing'
  | 'invalidUnitPrice'
  | 'noAmount'
  | 'truncatedRow'
  | 'noClientMatch'
  | 'ambiguousClient';

export function vendorRowError(
  id: VendorRowMessageId,
  params?: Record<string, string | number>,
): VendorRowError {
  const key = `imports.vendor.${id}`;
  return params ? { key, params } : { key };
}
