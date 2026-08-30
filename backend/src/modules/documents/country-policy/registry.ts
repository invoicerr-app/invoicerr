import { ALL_COUNTRY_POLICY_FILES } from './data/all';
import { CountryDocumentPolicyFile, DocumentActionRuleFact } from './schema';

function buildIndex(files: CountryDocumentPolicyFile[]): Record<string, CountryDocumentPolicyFile> {
  const index: Record<string, CountryDocumentPolicyFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the document-action policy files — the same role the (removed) VAT rate
 * catalog's `VatRateCatalog` played for tax rates, scaled to this concern. The seed
 * (seedCountryPolicies) reads `countries()`/`rulesFor()` to make the database match the files
 * exactly; `country-policy.ts`'s runtime evaluator reads the DATABASE, never this catalog directly —
 * see that file's header for why the split matters (a boot-time catalog and a per-request read are
 * different concerns, the same separation `VatRatesService` kept from `VatRateCatalog`).
 */
export class CountryPolicyCatalog {
  private readonly files: Record<string, CountryDocumentPolicyFile>;

  constructor(files: CountryDocumentPolicyFile[] = ALL_COUNTRY_POLICY_FILES) {
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
}

export const defaultCountryPolicyCatalog = new CountryPolicyCatalog();
