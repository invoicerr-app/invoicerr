/**
 * The country RETENTION-DURATION file format — root TODO item 14, "archivage légal ⚖". A retention
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
 * One legal obligation to retain a document for `years`, cited by `legalRef`. A country can (and, for
 * France, does) declare MORE THAN ONE of these — they are not alternatives a caller picks between,
 * they are simultaneous obligations on the same company (see `compute-retention.ts`).
 */
export interface RetentionRule {
  /** A short, human name for WHICH obligation this is — e.g. "fiscale" / "commerciale" for France.
   *  Free text, shown in `retentionBasis`; never used as a lookup key. */
  label: string;
  /** Whole years, counted from the archive's own `archivedAt` — see `compute-retention.ts`. */
  years: number;
  /** The article this duration comes from — carried so a reader can check it, and echoed verbatim
   *  into `DocumentArchive.retentionBasis`. MANDATORY: `assertValidRetentionRule` below refuses to
   *  load a rule with no `legalRef`, the same "a legal claim without a citation does not load"
   *  discipline `mentions/schema.ts#assertValidMentionRule` already holds for a mandatory mention,
   *  and `transports/channel-policy/schema.ts#assertValidChannelPolicyFact` holds for a channel
   *  mandate. This task's own rule: "N'invente AUCUNE durée légale — tout vient du repère avec ses
   *  références, ou est nul en le disant." */
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
 * The one gate a retention rule cannot get past without a real citation — same role
 * `mentions/schema.ts#assertValidMentionRule` plays for a mandatory mention. Called from
 * `data/all.ts` at load time, so a rule with no `legalRef` (or a non-positive `years`) fails as soon
 * as this module is imported (at boot), never silently.
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
  if (typeof rule.years !== 'number' || !Number.isFinite(rule.years) || rule.years <= 0) {
    throw new InvalidRetentionRuleError(
      `${context}: retention rule "${label}" has no positive numeric "years".`,
    );
  }
}
