/**
 * The country RETENTION-DURATION file format — "archivage légal ⚖". A retention
 * rule is a LEGAL DURATION a country's law requires business documents to be kept for, resolved
 * against the moment a document was archived. Same file-per-country, load-time-validated,
 * provenance-mandatory shape `documents/mentions/schema.ts` already established for a DIFFERENT
 * country-is-data concern — see this module's own `data/all.ts` header for why this format is
 * LOADED, never SEEDED into a table (no `resetAndSeed` re-seeds this; it is read straight from the
 * file on every boot, exactly like `mentions/`).
 *
 * France is the case that forced the SHAPE of this file (not merely one entry in it): C. com. art.
 * L123-22 imposes 10 years for accounting documents and vouchers, while LPF art. L102 B imposes 6
 * years for the documents a tax audit can be based on — TWO texts, TWO clocks, both binding the SAME
 * company AT THE SAME TIME. See `compute-retention.ts`'s own header for why `rules` is a LIST that is
 * ALL applied together, never a single duration a country "has".
 *
 * Declared as DATA, never as a branch on the country: `compute-retention.ts#computeRetention` derives
 * a duration from whatever a country's file lists, and a country with no file gets an honestly NULL
 * `retentionUntil` — never an invented one (see that function's own header).
 */

/**
 * WHAT a duration is counted FROM — see `compute-retention.ts`'s own header for the full reasoning
 * and the worked math behind `fiscalYearEndUnknownSafe`. Every statute sourced for this module picks
 * its own origin, and gets it WRONG if that choice is guessed rather than read:
 *
 *  - `'archivedAt'` — the moment THIS archive was actually written. Correct only for an obligation
 *    that is genuinely about the ACT OF ARCHIVING itself (none of this module's sourced rules are —
 *    every one found so far runs from a fact about the DOCUMENT, not about when this product happened
 *    to store it) — kept as a real option rather than removed, so a future country whose statute
 *    truly needs it is not forced into one of the other three.
 *  - `'issueDate'` — the document's own exact issue date, unrounded. France's fiscal rule (LPF art.
 *    L102 B, per BOI-CF-COM-10-10-30 §1: "le délai de six ans court à compter de … la date à laquelle
 *    les documents ou pièces ont été établis") uses exactly this: no year-end rounding, the day itself.
 *  - `'issueDateYearEnd'` — 31 December of the calendar year the document was issued in. Germany's
 *    UStG § 14b Abs. 1 Satz 3 ("mit dem Schluss des Kalenderjahres, in dem die Rechnung ausgestellt
 *    worden ist") and Portugal's CIVA art. 52.º n.º 1 ("os 10 anos civis subsequentes") both use this.
 *  - `'fiscalYearEndUnknownSafe'` — the STATUTE's real origin is the close of the company's own
 *    financial year (France's C. com. art. L123-22, commonly read as running "à compter de la clôture
 *    de l'exercice"), which this product cannot resolve exactly: nothing stores a company's own
 *    financial-year end (see `documents-core.module.ts`'s own registry — there is no such field on
 *    `Company`). Approximated SAFELY as `issueDate` + 1 calendar year — never shorter than the true
 *    close, see `compute-retention.ts` for why that specific padding is both safe and tight.
 *  - `'taxDeadlineYearEndUnknownSafe'` — the STATUTE's real origin is the end of the calendar year in
 *    which a TAX PAYMENT DEADLINE fell (Poland: ustawa o VAT art. 112 points to the limitation period
 *    of Ordynacja podatkowa art. 70 § 1, "licząc od końca roku kalendarzowego, w którym upłynął termin
 *    płatności podatku"), which is NOT the year of issue: a Polish VAT payment deadline is the month
 *    (or quarter) AFTER the invoice's own period, so an invoice issued in the closing weeks of a year
 *    can have its deadline — and so the whole limitation period — fall in the FOLLOWING calendar year.
 *    This product tracks neither a company's VAT filing frequency nor its exact settlement periods, so
 *    the exact deadline year cannot be resolved. Approximated SAFELY as 31 December of the calendar
 *    year AFTER the year of issue — see `compute-retention.ts` for why that bound covers every
 *    realistic filing frequency (monthly or quarterly) without needing to know which applies.
 *
 * MANDATORY on every rule, exactly like `legalRef` below: `assertValidRetentionRule` refuses to load a
 * rule that omits it, or names anything outside this list. A duration with no known origin is not
 * "assume `archivedAt`" — see `compute-retention.ts`'s own header for why that default is precisely
 * the defect this axis exists to correct. A rule whose statute was not read on this specific point is
 * a rule that does not ship, full stop.
 */
export type RetentionOrigin =
  | 'archivedAt'
  | 'issueDate'
  | 'issueDateYearEnd'
  | 'fiscalYearEndUnknownSafe'
  | 'taxDeadlineYearEndUnknownSafe';

const RETENTION_ORIGINS: readonly RetentionOrigin[] = [
  'archivedAt',
  'issueDate',
  'issueDateYearEnd',
  'fiscalYearEndUnknownSafe',
  'taxDeadlineYearEndUnknownSafe',
];

/**
 * One legal obligation to retain a document for `years`, counted from `origin`, cited by `legalRef`. A
 * country can (and, for France, does) declare MORE THAN ONE of these — they are not alternatives a
 * caller picks between, they are simultaneous obligations on the same company (see
 * `compute-retention.ts`).
 */
export interface RetentionRule {
  /** A short, human name for WHICH obligation this is — e.g. "fiscale" / "commerciale" for France.
   *  Free text, shown in `retentionBasis`; never used as a lookup key. */
  label: string;
  /** Whole years, counted from `origin` — see `RetentionOrigin` above and `compute-retention.ts`. */
  years: number;
  /** WHAT `years` is counted from — see `RetentionOrigin` above. MANDATORY, never defaulted: a rule
   *  whose statute was not read on this specific point is a rule this module refuses to load rather
   *  than guess for. */
  origin: RetentionOrigin;
  /** The article this duration comes from — carried so a reader can check it, and echoed verbatim
   *  into `DocumentArchive.retentionBasis`. MANDATORY: `assertValidRetentionRule` below refuses to
   *  load a rule with no `legalRef`, the same "a legal claim without a citation does not load"
   *  discipline `mentions/schema.ts#assertValidMentionRule` already holds for a mandatory mention,
   *  and `transports/channel-policy/schema.ts#assertValidChannelPolicyFact` holds for a channel
   *  mandate. */
  legalRef: string;
  /** Free-form sourcing/maintenance note — same convention as `mentions/schema.ts`'s own per-rule
   *  `notes`: JSON carries no comments, so a maintenance/sourcing note that would be a code comment
   *  on a TS file lives here instead. */
  notes?: string;
}

export interface CountryRetentionFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  /** EVERY rule here binds this country's companies SIMULTANEOUSLY — never a list a caller chooses
   *  ONE from. See `compute-retention.ts`'s own header for why the applicable retention is their
   *  MAXIMUM, not a decision between them. */
  rules: RetentionRule[];
  /** Free-form, file-level caveats — the same convention `mentions/schema.ts`'s own
   *  `CountryMentionsFile.notes` carries for a file-level (not per-rule) sourcing note. */
  notes?: string;
}

export class InvalidRetentionRuleError extends Error {}

/**
 * The one gate a retention rule cannot get past without a real citation AND a real origin — same role
 * `mentions/schema.ts#assertValidMentionRule` plays for a mandatory mention. Called from
 * `data/all.ts` at load time, so a rule with no `legalRef` (or a non-positive `years`, or an `origin`
 * outside `RetentionOrigin`) fails as soon as this module is imported (at boot), never silently.
 */
export function assertValidRetentionRule(rule: RetentionRule, context: string): void {
  const label = rule?.label ?? '(no label)';

  if (!rule || typeof rule.label !== 'string' || !rule.label.trim()) {
    throw new InvalidRetentionRuleError(
      `${context}: retention rule "${label}" has no "label" — a retention duration may never be ` +
        'applied without saying which obligation it discharges.',
    );
  }
  if (!rule.legalRef?.trim()) {
    throw new InvalidRetentionRuleError(
      `${context}: retention rule "${label}" has no "legalRef" — a retention duration may never be ` +
        'applied without citing the legal text that imposes it. No duration is ever invented here.',
    );
  }
  if (!RETENTION_ORIGINS.includes(rule.origin)) {
    throw new InvalidRetentionRuleError(
      `${context}: retention rule "${label}" has no valid "origin" (got ${JSON.stringify(rule.origin)}) — ` +
        `a retention duration may never be applied without saying what it is counted FROM. Must be one ` +
        `of: ${RETENTION_ORIGINS.join(', ')}. Never defaulted: a rule whose statute was not read on ` +
        'this specific point is a rule that does not load.',
    );
  }
  if (typeof rule.years !== 'number' || !Number.isFinite(rule.years) || rule.years <= 0) {
    throw new InvalidRetentionRuleError(
      `${context}: retention rule "${label}" has no positive numeric "years".`,
    );
  }
}
