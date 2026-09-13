/**
 * Legal archiving ⚖ — the delicate part. Turns a country's declared retention rules
 * (`schema.ts#CountryRetentionFile`) plus the document's own facts into a concrete `retentionUntil`
 * date and a `retentionBasis` string that CITES the rule(s) applied — never a bare number with no way
 * to check it.
 *
 * ## Origin axis: a duration is counted from what the STATUTE says, never from `archivedAt` by default
 *
 * The defect this file used to have: every rule was resolved as `addYears(archivedAt, rule.years)` —
 * counted from the moment THIS archive happened to be written, regardless of what the cited statute
 * actually says. That is wrong, and wrong in the DANGEROUS direction (too EARLY, meaning a company
 * could be told it may destroy a document the law still requires it to keep), for every rule this
 * module has sourced so far:
 *
 *  - Germany, UStG § 14b Abs. 1 Satz 3: "Die Aufbewahrungsfrist beginnt mit dem Schluss des
 *    Kalenderjahres, in dem die Rechnung ausgestellt worden ist" — the END of the calendar year of
 *    ISSUE, not the archiving instant.
 *  - Portugal, CIVA art. 52.º n.º 1: "os 10 anos civis subsequentes" — the ten calendar years
 *    SUBSEQUENT to the year of the operation, same shape as Germany's.
 *  - France's fiscal rule (LPF art. L102 B, per BOI-CF-COM-10-10-30 §1): "le délai de six ans court à
 *    compter de … la date à laquelle les documents ou pièces ont été établis" — the document's own
 *    exact issue date, not year-end-rounded and not the archiving instant either.
 *  - France's commercial rule (C. com. art. L123-22) is commonly read as running from the close of the
 *    company's own financial year — a THIRD origin again, and one this product cannot resolve exactly
 *    (see `fiscalYearEndUnknownSafe` below).
 *
 * `schema.ts#RetentionOrigin` makes this axis explicit and MANDATORY per rule (never defaulted — see
 * that type's own header), and `originDate` below is the only place that interprets it. `archivedAt`
 * remains a real, supported origin value for a rule that is genuinely about the archiving act itself —
 * none sourced so far need it, but the axis does not privilege it as a fallback.
 *
 * ## Why `fiscalYearEndUnknownSafe` is `issueDate` + exactly 1 calendar year, and why that is SAFE
 *
 * Nothing in this product stores a company's own financial-year end (see `Company` in
 * `schema.prisma`) — only the document's `issueDate` is known. A financial year is, by construction, a
 * 12-consecutive-month period recurring annually; whatever day within it the document was issued, the
 * close of THAT financial year is strictly LESS than 12 months after the issue date (the worst case —
 * the maximum possible gap — is achieved when the issue date falls the day after the previous year's
 * close, e.g. issued 1 January under a calendar-aligned exercice: the close is 31 December of the SAME
 * year, just under 12 months later). Treating the origin as `issueDate` + exactly 1 year is therefore:
 *  - SAFE — always on or after the true, unknown close, for every possible financial-year alignment;
 *  - TIGHT — the smallest whole-year padding that is safe for every alignment, so it never overstates
 *    by more than roughly the extra margin the true close itself could not have exceeded.
 * This is the "closest safe reading" this repo's own discipline demands when an exact origin cannot be
 * resolved: never the shorter guess, and not an arbitrarily longer one either.
 *
 * ## Why `taxDeadlineYearEndUnknownSafe` is 31 December of (issue year + 1)
 *
 * Poland's rule (ustawa o VAT art. 112, pointing to Ordynacja podatkowa art. 70 § 1) runs from the end
 * of the calendar year in which the underlying tax's PAYMENT DEADLINE fell — not the year of issue.
 * That deadline is the 25th of the month (or, for a quarterly filer, the month) after the invoice's own
 * settlement period, so it lands either in the SAME calendar year as the issue date (the common case)
 * or, for an invoice issued late enough in the year, in the NEXT one (a December invoice under monthly
 * filing; an October–December invoice under quarterly filing) — never any later, since a settlement
 * period is at most a calendar quarter and its deadline follows shortly after. This product tracks
 * neither a company's filing frequency nor its settlement periods, so the exact deadline year cannot be
 * resolved from the document alone. Anchoring on 31 December of (issue year + 1) is therefore SAFE for
 * every filing frequency without needing to know which one applies — never shorter than the true
 * deadline year's end, whichever of the two years it turns out to be.
 *
 * ## Why the applicable duration is the MAXIMUM of every declared rule, never a choice between them
 *
 * France declares two rules (`data/fr.json`): 6 years, fiscal (LPF art. L102 B), and 10 years,
 * commercial (C. com. art. L123-22). These are NOT two competing estimates of "how long to keep an
 * invoice" that this function picks the more likely one from — they are two DIFFERENT legal
 * obligations, imposed by two different bodies of law, that bind the SAME company AT THE SAME TIME,
 * on the SAME document. A company that destroyed an invoice after 6 years (satisfying the fiscal
 * duration alone) would still be in breach of the commercial one, which runs for 4 more years. The
 * EFFECTIVE floor a company must actually observe — the point at which EVERY simultaneous obligation
 * has expired — is therefore the MAXIMUM across all of them, never any single rule read in isolation.
 *
 * This is not this codebase inventing an answer to the open question its own removed compliance
 * engine (git tag `avant-refonte-documents`) left unresolved (see `documentation/internal/
 * DECISIONS.md`'s own entry D-001, and `documentation/internal/audit/03-LEGAL-VERIFICATION.md`'s
 * FR-D9): that question was "which ONE of the two should the engine treat as *the* retention
 * duration", framed as a choice between two facts that are not actually in competition. Applying
 * BOTH texts simultaneously — which is what French law genuinely requires of a French company
 * regardless of what any compliance engine decides — sidesteps that framing rather than resolving it
 * by fiat; D-001 itself already anticipated this ("the product should probably carry both rather
 * than choose one"). A future rule that names an
 * ACTUAL exception (one obligation genuinely superseding another, rather than two independently
 * binding ones) would be a real re-opening of this reasoning — this file is not that.
 *
 * ## Why a country with no file — or no resolvable rule — gets an honest NULL, never an invented one
 *
 * The non-negotiable rule this module holds to: invent NO legal duration — everything comes from
 * the removed compliance engine's own sourced references, or is stated as null. A country nobody
 * has sourced a retention rule for gets
 * `retentionUntil: null` and a `retentionBasis` that says so PLAINLY — never a guessed number that
 * would look exactly as authoritative as a sourced one to anything reading this column later.
 * Archiving itself is NEVER skipped for such a country (see `archive-on-send.ts`'s own header):
 * integrity — the hash, the stored bytes — is owed to every company, retention guidance is not. The
 * same honest-null applies when a country DOES have a file but its `issueDate` was not available to
 * resolve it (see `originDate` below) — never silently substituting `archivedAt`, which is the exact
 * defect this whole axis exists to fix, and per `mandate.ts`'s own precedent for a missing issue date,
 * a case a document type's own "save-draft" validation is expected to make unreachable in practice.
 */
import { CountryRetentionFile, RetentionOrigin, RetentionRule } from './schema';

export interface ResolvedRetention {
  retentionUntil: Date | null;
  /** ALWAYS set, even when `retentionUntil` is null — names either the rule(s) actually applied
   *  (with their own `legalRef`) or states plainly that this country has no declared rule. Free
   *  text, shown as-is (same convention as `ActionResult.message`) — never an i18n key. */
  retentionBasis: string;
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

/** 31 December of `date`'s own UTC calendar year, at midnight UTC. */
function endOfYearUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
}

/**
 * The date `rule.years` is counted FROM, per its own declared `origin` — the only place this module
 * interprets `RetentionOrigin` (see that type's own header in `schema.ts` for what each value means
 * and why). Returns `null` when the origin needed a datum this call was not given — `issueDate` for
 * every origin except `'archivedAt'` — rather than ever substituting a different date for it.
 */
function originDate(origin: RetentionOrigin, archivedAt: Date, issueDate: Date | undefined): Date | null {
  switch (origin) {
    case 'archivedAt':
      return archivedAt;
    case 'issueDate':
      return issueDate ?? null;
    case 'issueDateYearEnd':
      return issueDate ? endOfYearUtc(issueDate) : null;
    case 'fiscalYearEndUnknownSafe':
      // issueDate + 1 calendar year — see this file's own header for why that is both SAFE and TIGHT
      // as a stand-in for "the close of a financial year this product does not store".
      return issueDate ? addYears(issueDate, 1) : null;
    case 'taxDeadlineYearEndUnknownSafe':
      // 31 December of (issue year + 1) — see this file's own header for why that safely covers "the
      // end of the calendar year a tax payment deadline fell in" regardless of filing frequency.
      return issueDate ? endOfYearUtc(addYears(issueDate, 1)) : null;
  }
}

function describeRule(rule: RetentionRule): string {
  return `${rule.label} ${rule.years}y (${rule.legalRef})`;
}

/**
 * Resolves the retention this ARCHIVE (not the document in the abstract — the specific bytes written
 * at `archivedAt`) must be kept until, for a country whose file may or may not exist. `issueDate` is
 * the DOCUMENT's own issue date (never `archivedAt` used as a stand-in for it — see this file's own
 * header) — required to honour any rule whose `origin` is not `'archivedAt'` itself.
 */
export function computeRetention(
  file: CountryRetentionFile | undefined,
  archivedAt: Date,
  issueDate: Date | undefined,
): ResolvedRetention {
  const rules = file?.rules ?? [];

  if (rules.length === 0) {
    return {
      retentionUntil: null,
      retentionBasis: file
        ? `No retention rule declared for ${file.countryCode} — no duration invented.`
        : 'No retention rule declared for this country — no duration invented.',
    };
  }

  const resolved = rules
    .map((rule) => ({ rule, origin: originDate(rule.origin, archivedAt, issueDate) }))
    .filter((r): r is { rule: RetentionRule; origin: Date } => r.origin !== null)
    .map((r) => ({ rule: r.rule, until: addYears(r.origin, r.rule.years) }));

  if (resolved.length === 0) {
    // Every declared rule needed the document's own issue date and it was not available — see this
    // file's own header. Defensive: a document type with a "send" action validates issueDate at
    // save-draft (see `mandate.ts`'s own precedent), so this branch is expected to be unreachable in
    // practice, not a normal case archiving is designed to paper over with a guess.
    return {
      retentionUntil: null,
      retentionBasis:
        `${file!.countryCode} declares ${rules.length} retention rule(s) ` +
        `(${rules.map(describeRule).join('; ')}) but none could be resolved: the document's own issue ` +
        'date is missing or unparseable, and no declared rule here runs from the archiving instant alone.',
    };
  }

  // The MAXIMUM computed date across every SIMULTANEOUS obligation — see this file's own header. Not
  // the rule with the most `years`: a shorter duration counted from an EARLIER origin can still land
  // later, or a longer one from a LATER origin can still win — only the actual computed dates compare.
  const winning = resolved.reduce((longest, r) =>
    r.until.getTime() > longest.until.getTime() ? r : longest,
  );
  const others = resolved.filter((r) => r !== winning);
  const skipped = rules.length - resolved.length;

  let retentionBasis =
    others.length === 0
      ? `${describeRule(winning.rule)}.`
      : `${describeRule(winning.rule)} — the longer of ${resolved.length} obligations that apply ` +
        `simultaneously to the same company: ${resolved.map((r) => describeRule(r.rule)).join('; ')}.`;
  if (skipped > 0) {
    retentionBasis += ` (${skipped} other declared rule(s) could not be resolved: missing issue date.)`;
  }

  return { retentionUntil: winning.until, retentionBasis };
}
