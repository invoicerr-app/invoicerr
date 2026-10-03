import { defaultComposedCountryCatalog } from '../countries/registry';
import {
  CountryDocumentPolicyFile,
  CountryNumberFormats,
  DocumentActionRuleFact,
  DocumentNumberingFact,
  DocumentValidationCodeFact,
  DomesticInvoiceCurrencyFact,
  InvoiceValidationFact,
} from './schema';

function buildIndex(files: CountryDocumentPolicyFile[]): Record<string, CountryDocumentPolicyFile> {
  const index: Record<string, CountryDocumentPolicyFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 5): every country's own `policy` section from the
 * composed per-country view, instead of this catalog's own `data/all.ts` directly. No import cycle
 * results, because `countries/compose.ts` reads the RAW loader (`country-policy/data/all.ts`'s own
 * `ALL_COUNTRY_POLICY_FILES`), never this registry: see that file's own header. The dependency
 * direction is therefore one-way: this file depends on `countries/registry.ts`, which depends on
 * `countries/compose.ts`, which depends on `country-policy/data/all.ts`; nothing depends back on
 * this file from inside that chain, the same shape `vat-rates/registry.ts` (step 2) and
 * `country-fields/registry.ts` (step 3) already proved. `seedCountryPolicies`, `boot-reseed.ts` and
 * `backend/scripts/release-catalogs.ts` all read `defaultCountryPolicyCatalog` below, never
 * `data/all.ts` directly, so none of those three need any change for this step: only where the
 * no-argument default reads from moves. A country with no `policy` section in the composed view is
 * simply left out here, the same "no permissive fallback" this catalog already held when it read
 * `ALL_COUNTRY_POLICY_FILES` directly.
 */
function countryPoliciesFromComposedCatalog(): CountryDocumentPolicyFile[] {
  const files: CountryDocumentPolicyFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const policy = defaultComposedCountryCatalog.get(countryCode)?.policy;
    if (policy) files.push(policy);
  }
  return files;
}

/**
 * In-memory view of the document-action policy files — the same role the (removed) VAT rate
 * catalog's `VatRateCatalog` played for tax rates, scaled to this concern. The seed
 * (seedCountryPolicies) reads `countries()`/`rulesFor()` to make the database match the files
 * exactly; `country-policy.ts`'s runtime evaluator reads the DATABASE, never this catalog directly —
 * see that file's header for why the split matters (a boot-time catalog and a per-request read are
 * different concerns, the same separation `VatRatesService` kept from `VatRateCatalog`).
 *
 * The constructor still takes a plain `CountryDocumentPolicyFile[]` (never the composed catalog
 * itself), so an explicit, smaller list still works exactly as before for every existing caller and
 * test (e.g. `new CountryPolicyCatalog([FR_FILE])`): only the NO-ARGUMENT default changed where it
 * reads from.
 */
export class CountryPolicyCatalog {
  private readonly files: Record<string, CountryDocumentPolicyFile>;

  constructor(files: CountryDocumentPolicyFile[] = countryPoliciesFromComposedCatalog()) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have a policy file — sorted, for stable test/seed iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  /** Every rule declared for a country, in file order. Empty for a country with no file at all. */
  rulesFor(countryCode: string): DocumentActionRuleFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.rules ?? [];
  }

  /**
   * Which document TYPES a country's file declares at all — a separate layer from `rulesFor`, which
   * governs individual ACTIONS on a type already assumed to exist for that country. See schema.ts's
   * `CountryDocumentPolicyFile.documentTypes` for why this is its own declared list rather than
   * derived from `rules` (a type could plausibly be declared with zero actions yet, or a country
   * could want to hide a type its `rules` still mention for historical reasons — nothing here
   * cross-validates the two against each other, the same declared independence `rulesFor` already
   * keeps from the live DocumentTypeRegistry). Empty for a country with no file at all — the same
   * "no permissive fallback" discipline `rulesFor` holds.
   */
  typesFor(countryCode: string): string[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.documentTypes ?? [];
  }

  /** Every numbering fact declared for a country (issue #471) - see schema.ts's own
   *  `CountryDocumentPolicyFile.numbering` header for why this is file-only (validated, never
   *  seeded to a DB table). Empty for a country with no such fact at all, the same "no permissive
   *  fallback" discipline `rulesFor`/`typesFor` above already hold. */
  numberingFor(countryCode: string): DocumentNumberingFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.numbering ?? [];
  }

  /** The number formats and their constraints declared for a country (issue #496) - file-only, like
   *  `numberingFor` above. `undefined` for a country with no file: there is no fallback format, the
   *  same "no permissive fallback" discipline every other reader here holds. */
  numberFormatsFor(countryCode: string): CountryNumberFormats | undefined {
    return this.files[(countryCode ?? '').toUpperCase()]?.numberFormats;
  }

  /** The domestic-invoicing-currency obligation declared for a country (issue #558) - file-only, like
   *  `numberFormatsFor` above. `undefined` for a country with no such fact: there is no fallback
   *  currency, the same "no permissive fallback" discipline every other reader here holds. */
  domesticInvoiceCurrencyFor(countryCode: string): DomesticInvoiceCurrencyFact | undefined {
    return this.files[(countryCode ?? '').toUpperCase()]?.domesticInvoiceCurrency;
  }

  /** Whether VALIDATING an invoice transmits it through this country's own mandated channel (issue
   *  #581) - file-only, like `domesticInvoiceCurrencyFor` above. `undefined` for a country with no
   *  such fact declared (DE/PL/PT/DZ today): there is no fallback, the same "no permissive fallback"
   *  discipline every other reader here holds - see schema.ts's own `InvoiceValidationFact` header. */
  invoiceValidationFor(countryCode: string): InvoiceValidationFact | undefined {
    return this.files[(countryCode ?? '').toUpperCase()]?.invoiceValidation;
  }

  /** Whether this country requires a validation-code scheme on its own documents (issue #603) -
   *  file-only, like `invoiceValidationFor` above. `undefined` for a country with no such scheme
   *  declared (every shipped country but Portugal today): there is no fallback scheme, the same "no
   *  permissive fallback" discipline every other reader here holds - see schema.ts's own
   *  `DocumentValidationCodeFact` header. The single replacement for the four independent `=== 'PT'`
   *  literals this catalog's own AUDIT_DONNEES_PAYS.md named (section 1, row 3). */
  documentValidationCodeFor(countryCode: string): DocumentValidationCodeFact | undefined {
    return this.files[(countryCode ?? '').toUpperCase()]?.documentValidationCode;
  }
}

export const defaultCountryPolicyCatalog = new CountryPolicyCatalog();
