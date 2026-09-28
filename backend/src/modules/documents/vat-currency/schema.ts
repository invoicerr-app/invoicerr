/**
 * Issue #517: "an invoice in a foreign currency never states its VAT in the national currency".
 * The country CATALOG format for that one narrow fact: does the seller's own country require the
 * VAT (and, in Italy's case, the taxable amount too) to ALSO be printed converted into the country's
 * OWN official currency, when the invoice itself is issued in a different one, and if so, from
 * which rate source and dated how.
 *
 * Modeled on `content-requirements/schema.ts`'s own `ContentRequirementFact` (a different EN 16931
 * concern: that format decides whether a structured field carries a DERIVABLE value, this one
 * decides whether TWO figures need a SECOND, converted rendering), same "one file per country, own
 * schema, own loader" shape every sibling catalog in `documents/` already holds, same reused
 * `PolicyProvenance` union `country-policy/schema.ts` already exports (unlike content-requirements,
 * which is always `LegalProvenance`: this format DOES need the `'unverified'` branch, because
 * Portugal's own CIVA text was read and did not, on direct inspection, confirm an invoice-level
 * obligation; see `data/pt.json`'s own `notes`).
 *
 * Reused, never duplicated: `country-policy/schema.ts`'s `PolicyProvenance`/`LegalProvenance`/
 * `UnverifiedProvenance`/`assertValidPolicyProvenance`. A second provenance union here would be the
 * exact "two independently-evolving sources of the same shape" risk this codebase's own catalogs
 * already avoid for `DocumentActionRuleFact` and `DocumentNumberingFact`.
 */
import {
  assertValidPolicyProvenance,
  LegalProvenance,
  PolicyProvenance,
  UnverifiedProvenance,
} from '../country-policy/schema';

export { LegalProvenance, PolicyProvenance, UnverifiedProvenance };

/** Where the exchange rate this feature freezes onto a document actually comes from. Never a third,
 *  generic "automatic" value the way `currency-rates/currency-rate-sweep.ts`'s own
 *  `AUTOMATIC_RATE_SOURCES` allows an ECB/open.er-api.com CHOICE for the dashboard's own
 *  consolidation: this feature prints a LEGAL figure, so the source is the one the country's own
 *  statute names, never a fallback: 'none' for a country with no requirement at all (DE, PT today). */
export type VatCurrencyRateSource = 'ecb' | 'nbp' | 'none';

export interface VatCurrencyRule {
  /** ISO 4217 code of the country's own official currency: EUR for every euro-area member state
   *  covered here (FR/IT/DE/PT), PLN for Poland. This is NOT `Company.currency` (a seller can invoice
   *  in a currency other than its own country's, which is exactly the scenario this whole feature
   *  exists for) and not `Company.referenceCurrency` (the dashboard-only consolidation opt-in,
   *  `currency-consolidation.ts`'s own concern). A THIRD, country-derived fact this format is what
   *  introduces. */
  nationalCurrency: string;
  /** Whether the law requires the converted VAT amount to be printed on an invoice ISSUED IN A
   *  DIFFERENT currency. `false` is a genuine, sourced "no such requirement was found on the invoice
   *  itself" (Germany: §16 Abs. 6 UStG only reaches the RETURN, never the invoice; Portugal: CIVA's
   *  own art. 16 does not, on direct reading, extend to art. 36's invoice-content list). A
   *  RESEARCHED conclusion, distinct from a country having no file at all (no invoice ever converts
   *  for THAT country either, but `registry.ts#resolveVatCurrencyRule` returns `null` rather than an
   *  explicit "false", the same "a country with no known catalog is left alone entirely, not a
   *  regression risk" permissiveness `vat-rates/registry.ts`'s own header already documents for a
   *  different catalog). */
  requiredOnInvoice: boolean;
  /** Whether the TAXABLE AMOUNT (net, the VAT base) must ALSO be converted and printed, not merely
   *  the VAT figure itself. Italy only, today: DPR 633/1972 art. 21 c.2 lett. l) names BOTH
   *  "l'ammontare dell'imposta e dell'imponibile" in euros; France's own BOFiP §380 and Poland's VAT
   *  act art. 106e ust. 11 each name only the TAX amount. Meaningless (and ignored by every caller)
   *  when `requiredOnInvoice` is false. */
  taxableAmountRequiredOnInvoice: boolean;
  rateSource: VatCurrencyRateSource;
  /**
   * Free text, quoted from (or closely paraphrasing) the statute's own anchor date, deliberately
   * NOT a machine-readable enum: FR ("the ECB rate last published on the day VAT becomes chargeable",
   * CGI art. 266, 1 bis), PL ("the NBP Table A average rate of the last business day PRECEDING the
   * day the tax obligation arises", VAT act art. 31a ust. 1, exclusive of the tax-point day itself)
   * and IT ("the rate of the day the operation was carried out, or, absent that, the day the invoice
   * was issued", DPR 633/1972 art. 13 c.4) each phrase a genuinely different anchor, and a shared
   * enum would flatten a real legal difference (PL's own "preceding", not "on") into something this
   * resolver could silently get wrong. `../vat-currency-issuance.ts` is the one place this free text
   * is turned into an actual date computation, by name, per rate source, never generically parsed.
   * Optional: meaningful, and required (`assertValidVatCurrencyRule` enforces it), only when
   * `requiredOnInvoice` is true; a country with no invoice-level requirement (DE/PT) leaves this
   * unset rather than describing a rate rule this codebase never actually applies to a printed
   * document.
   */
  rateDateRule?: string;
  provenance: PolicyProvenance;
  /** Free-form caveats, same convention as every sibling format's own `notes`. */
  notes?: string;
}

export interface CountryVatCurrencyFile {
  /** ISO 3166-1 alpha-2, uppercase, must match the file's own name (`data/all.ts` checks this). */
  countryCode: string;
  rule: VatCurrencyRule;
}

export class InvalidVatCurrencyRuleError extends Error {}

const KNOWN_RATE_SOURCES: ReadonlySet<VatCurrencyRateSource> = new Set(['ecb', 'nbp', 'none']);

/**
 * The one gate a VAT-currency rule cannot get past without a real, sourced provenance. Called from
 * `data/all.ts` at load time, the same single-gate discipline `content-requirements/schema.ts#
 * assertValidContentRequirementFact`'s own header explains is enough here (nothing in this format is
 * ever mirrored into a database the way `country-policy/`'s own facts are, so there is no second,
 * seed-time gate to mirror).
 */
export function assertValidVatCurrencyRule(file: CountryVatCurrencyFile, context: string): void {
  const rule = file.rule;
  if (!rule) {
    throw new InvalidVatCurrencyRuleError(`${context}: missing "rule".`);
  }
  if (rule.nationalCurrency.trim()?.length !== 3) {
    throw new InvalidVatCurrencyRuleError(
      `${context}: "nationalCurrency" must be a real 3-letter ISO 4217 code, got ` +
        `${JSON.stringify(rule.nationalCurrency)}.`,
    );
  }
  if (typeof rule.requiredOnInvoice !== 'boolean') {
    throw new InvalidVatCurrencyRuleError(`${context}: "requiredOnInvoice" must be a boolean.`);
  }
  if (typeof rule.taxableAmountRequiredOnInvoice !== 'boolean') {
    throw new InvalidVatCurrencyRuleError(`${context}: "taxableAmountRequiredOnInvoice" must be a boolean.`);
  }
  if (!KNOWN_RATE_SOURCES.has(rule.rateSource)) {
    throw new InvalidVatCurrencyRuleError(
      `${context}: "rateSource" must be one of "ecb"/"nbp"/"none", got ${JSON.stringify(rule.rateSource)}.`,
    );
  }
  if (rule.requiredOnInvoice && rule.rateSource === 'none') {
    throw new InvalidVatCurrencyRuleError(
      `${context}: "requiredOnInvoice" is true but "rateSource" is "none": a requirement this ` +
        'codebase must actually honour needs a real, named rate source, never a silent no-op.',
    );
  }
  if (rule.requiredOnInvoice && !rule.rateDateRule?.trim()) {
    throw new InvalidVatCurrencyRuleError(
      `${context}: "requiredOnInvoice" is true but "rateDateRule" is missing: a requirement with no ` +
        'stated anchor date can never be resolved against an invoice.',
    );
  }
  assertValidPolicyProvenance(
    rule.provenance,
    `${context}: VAT-currency rule for "${file.countryCode}"`,
    'a VAT-currency rule',
  );
}
