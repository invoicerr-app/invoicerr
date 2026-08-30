/**
 * The per-company VIEW of a document type's FIELDS — the field-level analogue of
 * documents.service.ts's own action-level `policyBlockedReason` annotation. A descriptor
 * (descriptors/*.descriptor.ts) stays pure, country-agnostic data forever; this is the ONE place a
 * company's resolved country is allowed to shape what its fields look like, and it does so in
 * exactly two ways:
 *
 *  1. The country FIELD OVERLAY (country-fields/) — add, modify, or remove a field outright. Empty
 *     for a country with no overlay file, which leaves the trunk fields UNCHANGED (see
 *     apply-overlay.ts's own header on "unchanged values, never the same object").
 *  2. The VAT RATE CATALOG (vat-rates/) — any field marked `usesVatRateCatalog` gets its `options`
 *     filled from the catalog for this company's country, or, when no catalog is known at all, an
 *     honest notice instead of a dead, option-less control (see field-kinds.ts's 'select' validator
 *     and the frontend's SelectField for the two matching halves of this same escape hatch).
 *
 * Both are additive/replacing transformations over a FRESH clone — nothing here ever mutates the
 * `fields` a descriptor was registered with. `countryCode` may be undefined (an unresolved country,
 * e.g. a company whose country name doesn't map to an ISO code) — both catalogs are already required
 * to answer "nothing known" for that case rather than throw, so this function simply passes it
 * through as an empty string, which neither catalog will ever have an entry for.
 */
import { CountryFieldOverlayCatalog } from '../country-fields/registry';
import { applyFieldOverlay } from '../country-fields/apply-overlay';
import { VatRateCatalog, vatRateFieldOptions } from '../vat-rates/registry';
import { DocumentFieldDescriptor } from './types';

const NO_VAT_CATALOG_HELP_TEXT =
  "No known VAT rate list for this company's country — enter the applicable rate manually.";

/**
 * Recursively finds every field with `usesVatRateCatalog: true` — including one nested inside an
 * 'array' field's own `fields` (the invoice's `lines.vatRate` is the only one today) — and fills its
 * `options`/`helpText` in place. MUTATES `fields`: only ever call this on a fresh clone (see
 * `applyCompanyFieldView` below, the only caller), never on a descriptor's own shared fields.
 */
function applyVatRateCatalogOptions(
  fields: DocumentFieldDescriptor[],
  countryCode: string,
  catalog: VatRateCatalog,
): void {
  for (const field of fields) {
    if (field.kind === 'select' && field.usesVatRateCatalog) {
      const resolution = vatRateFieldOptions(catalog, countryCode);
      field.options = resolution.options;
      if (!resolution.known) {
        field.helpText = NO_VAT_CATALOG_HELP_TEXT;
      }
    }
    if (field.kind === 'array' && field.fields) {
      applyVatRateCatalogOptions(field.fields, countryCode, catalog);
    }
  }
}

export interface CompanyFieldViewParams {
  typeId: string;
  fields: DocumentFieldDescriptor[];
  /** The active company's resolved ISO 3166-1 alpha-2 country code, or undefined when it could not
   *  be resolved at all (see country-policy/country-policy.ts's `resolveCompanyCountryCode`). */
  countryCode: string | undefined;
  fieldOverlayCatalog: CountryFieldOverlayCatalog;
  vatRateCatalog: VatRateCatalog;
}

/**
 * Builds the fields a specific company should actually see/submit for `typeId` — see this file's
 * header for the two transformations, applied in this order (the overlay decides the SHAPE first;
 * the VAT-catalog pass then fills in dynamic, per-company DATA on whatever shape came out of it,
 * including a field an overlay itself just added).
 */
export function applyCompanyFieldView(params: CompanyFieldViewParams): DocumentFieldDescriptor[] {
  const countryCode = (params.countryCode ?? '').toUpperCase();
  const operations = countryCode ? params.fieldOverlayCatalog.operationsFor(countryCode, params.typeId) : [];
  const fields = applyFieldOverlay(params.fields, operations);
  applyVatRateCatalogOptions(fields, countryCode, params.vatRateCatalog);
  return fields;
}
