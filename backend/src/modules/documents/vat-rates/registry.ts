import { ALL_VAT_RATE_FILES } from './data/all';
import { CountryVatRatesFile, VatRateFact } from './schema';

function buildIndex(files: CountryVatRatesFile[]): Record<string, CountryVatRatesFile> {
  const index: Record<string, CountryVatRatesFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the VAT rate catalog files — the same role country-fields/registry.ts's
 * `CountryFieldOverlayCatalog` and country-policy/registry.ts's `CountryPolicyCatalog` play for
 * their own concerns. `descriptors/company-view.ts` is the only consumer: it reads `ratesFor`
 * (through `vatRateFieldOptions` below) to fill a 'select' field's `options` per company.
 */
export class VatRateCatalog {
  private readonly files: Record<string, CountryVatRatesFile>;

  constructor(files: CountryVatRatesFile[] = ALL_VAT_RATE_FILES) {
    this.files = buildIndex(files);
  }

  has(countryCode: string): boolean {
    return !!this.files[(countryCode ?? '').toUpperCase()];
  }

  /** Country codes that have a catalog file — sorted, for stable test/iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  /** Every rate declared for a country, in file order. Empty for a country with no file at all — the
   *  same "no permissive fallback, no silent gap" shape `CountryPolicyCatalog.rulesFor` already
   *  holds, though here "gap" means "no known catalog", not "forbidden". */
  ratesFor(countryCode: string): VatRateFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.rates ?? [];
  }
}

export const defaultVatRateCatalog = new VatRateCatalog();

export interface VatRateFieldOption {
  value: string;
  label: string;
}

export interface VatRateOptionsResolution {
  /** The options a 'select' field should offer — empty when this country's catalog is unknown. */
  options: VatRateFieldOption[];
  /** NEVER rendered as a choice — see `DocumentFieldDescriptor.legacyOptions`'s own header
   *  (descriptors/types.ts). Backward compatibility ONLY, for a `vatRate` already persisted as a bare
   *  percentage string before `options` switched to each rate's own stable `id`. */
  legacyOptions: VatRateFieldOption[];
  /** Whether a catalog is known for this country AT ALL. `false` (not merely "options is empty")
   *  is what descriptors/company-view.ts uses to decide whether to show the "no known list" notice —
   *  a country could in principle have a catalog file that (temporarily) lists zero rates, which
   *  would still be "known", just empty; that is not a case this catalog needs to distinguish today
   *  (no shipped file does this), but the two concepts are kept separate rather than conflated. */
  known: boolean;
}

/**
 * Turns a country's VAT rate catalog into the `options` a 'select' field descriptor can offer.
 *
 * `value` is each rate's own stable CATALOG `id` (e.g. "it-esente"), never the bare percentage — a
 * plain `String(rate.rate)` cannot tell apart two rates that happen to share the SAME percentage but
 * mean two entirely different legal regimes (Italy's `it-esente`/"esente", no input-VAT deduction
 * right, vs. `it-non-imponibile`/"non imponibile", deduction right preserved — both 0%, see
 * `vat-rates/data/it.json`'s own notes). A dropdown keyed by the bare number would offer the SAME
 * "0" for both, and whichever a caller picked would be indistinguishable from the other once stored —
 * exactly the ambiguity a catalog `id` exists to prevent. `label` still carries the human-readable
 * percentage + the country's own official term (e.g. "20% — Taux normal"), unaffected by this change.
 *
 * `legacyOptions` is the bare-percentage form this function used to emit as `options` itself —
 * preserved so `resolveVatRatePercentage` below (and `field-kinds.ts`'s own validator, via
 * `DocumentFieldDescriptor.legacyOptions`) can still recognize a `vatRate` any document saved BEFORE
 * this change already carries, without EVER offering that form again as a fresh choice.
 *
 * Never throws for an unknown country: `known: false` with an empty list is the whole point of this
 * function existing — see descriptors/company-view.ts's own header on "no known catalog blocks
 * nobody".
 */
export function vatRateFieldOptions(catalog: VatRateCatalog, countryCode: string): VatRateOptionsResolution {
  const known = catalog.has(countryCode);
  const rates = catalog.ratesFor(countryCode);
  return {
    known,
    options: rates.map((rate) => ({
      value: rate.id,
      label: `${rate.rate}% — ${rate.label}`,
    })),
    legacyOptions: rates.map((rate) => ({
      value: String(rate.rate),
      label: `${rate.rate}% — ${rate.label}`,
    })),
  };
}

/**
 * Resolves a STORED `vatRate` field value — the catalog `id` `vatRateFieldOptions` now emits as the
 * canonical `value` (e.g. "it-esente"), OR the bare percentage string a document saved before that
 * change still carries (e.g. "20") — back to the ACTUAL PERCENTAGE every numeric consumer downstream
 * needs (`tax/resolve-invoice-tax.ts`'s own domestic-rate check, `formats/shared-build.ts`'s BT-152
 * "VAT rate" field). Tries the id form FIRST — a bare-percentage value can never collide with a real
 * catalog id (every shipped id is a `country-slug` string, never a plain number), so there is no
 * ambiguity to break a tie on. `null` when `storedValue` matches NEITHER form for this country: an
 * unknown/foreign rate, or simply a value that was never a VAT-rate-catalog one to begin with — the
 * caller decides what that means, the same "report the fact, let the caller judge it" posture this
 * module already holds elsewhere.
 */
export function resolveVatRatePercentage(
  catalog: VatRateCatalog,
  countryCode: string,
  storedValue: string,
): number | null {
  const rates = catalog.ratesFor(countryCode);
  const byId = rates.find((rate) => rate.id === storedValue);
  if (byId) return byId.rate;

  const asPercentage = Number(storedValue);
  if (Number.isFinite(asPercentage) && rates.some((rate) => rate.rate === asPercentage)) {
    return asPercentage;
  }
  return null;
}

/**
 * Resolves a VAT rate `id` REGARDLESS of which country's own catalog it belongs to — every shipped
 * id is already globally unique BY CONVENTION (each country's own catalog prefixes its ids with its
 * own country code, e.g. "it-esente", "fr-standard" — no two countries have ever picked the same
 * slug), so no country needs to be known in advance to look one up. Exists for
 * `totals/compute-totals.ts#extractVatRate`, which computes a document's totals from its own
 * descriptor/data ALONE — it has no notion of "which company", let alone which country, it is being
 * asked about, unlike every other reader in this module (`resolveVatRatePercentage`/
 * `resolveVatRateFact` above, both scoped to one already-known seller country).
 */
export function findVatRateById(catalog: VatRateCatalog, id: string): VatRateFact | undefined {
  for (const countryCode of catalog.countries()) {
    const found = catalog.ratesFor(countryCode).find((rate) => rate.id === id);
    if (found) return found;
  }
  return undefined;
}

/** The SAME rate a `resolveVatRatePercentage` lookup found, in full — for a caller that also needs
 *  the `category`/`id`/provenance (e.g. `fatturapa-provider.ts#mapNatura`'s own Natura derivation),
 *  never only the bare number. `undefined` under the exact same "matches neither form" condition
 *  `resolveVatRatePercentage` itself refuses on. */
export function resolveVatRateFact(
  catalog: VatRateCatalog,
  countryCode: string,
  storedValue: string,
): VatRateFact | undefined {
  const rates = catalog.ratesFor(countryCode);
  const byId = rates.find((rate) => rate.id === storedValue);
  if (byId) return byId;

  const asPercentage = Number(storedValue);
  if (!Number.isFinite(asPercentage)) return undefined;
  return rates.find((rate) => rate.rate === asPercentage);
}
