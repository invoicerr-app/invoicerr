/**
 * Every row-level reason the vendor export reader can give, as an i18n key plus its values. The
 * sentences belong in `frontend/src/locales/en/translation.json` under `imports.vendor.*`, added
 * with the import dialog that renders them, so the preview follows the interface language instead
 * of printing English into a French screen.
 *
 * A whole-file refusal (`VendorExportMappingError`) stays a plain English message: it names a
 * missing column on the file the user picked, and no row is shown for it.
 */
import { VendorRowError } from './vendor-export.types';

/** One key per row reason; the union is what keeps a producer from inventing a name. */
export type VendorRowMessageId = 'clientNoName' | 'companyNoName' | 'truncatedRow';

export function vendorRowError(
  id: VendorRowMessageId,
  params?: Record<string, string | number>,
): VendorRowError {
  const key = `imports.vendor.${id}`;
  return params ? { key, params } : { key };
}
