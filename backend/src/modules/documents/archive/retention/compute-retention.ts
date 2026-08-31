/**
 * Root TODO item 14's own ⚖ — the delicate part. Turns a country's declared retention rules
 * (`schema.ts#CountryRetentionFile`) plus the moment an archive was actually written into a concrete
 * `retentionUntil` date and a `retentionBasis` string that CITES the rule(s) applied — never a bare
 * number with no way to check it.
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
 * This is not this codebase inventing an answer to the open question its own repère (git tag
 * `avant-refonte-documents`) left unresolved (see `docs/compliance/DECISIONS.md`'s own entry D-001,
 * and `docs/compliance/audit/03-LEGAL-VERIFICATION.md`'s FR-D9): that question was "which ONE of the
 * two should the engine treat as *the* retention duration", framed as a choice between two facts that
 * are not actually in competition. Applying BOTH texts simultaneously — which is what French law
 * genuinely requires of a French company regardless of what any compliance engine decides — sidesteps
 * that framing rather than resolving it by fiat; D-001 itself already anticipated this ("le produit
 * devrait probablement porter les deux plutôt que d'en choisir une"). A future rule that names an
 * ACTUAL exception (one obligation genuinely superseding another, rather than two independently
 * binding ones) would be a real re-opening of this reasoning — this file is not that.
 *
 * ## Why a country with no file gets an honest NULL, never an invented duration
 *
 * This task's own non-negotiable: "N'invente AUCUNE durée légale — tout vient du repère avec ses
 * références, ou est nul en le disant." A country nobody has sourced a retention rule for gets
 * `retentionUntil: null` and a `retentionBasis` that says so PLAINLY — never a guessed number that
 * would look exactly as authoritative as a sourced one to anything reading this column later.
 * Archiving itself is NEVER skipped for such a country (see `archive-on-send.ts`'s own header):
 * integrity — the hash, the stored bytes — is owed to every company, retention guidance is not.
 */
import { CountryRetentionFile, RetentionRule } from './schema';

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

function describeRule(rule: RetentionRule): string {
  return `${rule.label} ${rule.years}y (${rule.legalRef})`;
}

/**
 * Resolves the retention this ARCHIVE (not the document in the abstract — the specific bytes written
 * at `archivedAt`) must be kept until, for a country whose file may or may not exist.
 */
export function computeRetention(
  file: CountryRetentionFile | undefined,
  archivedAt: Date,
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

  // The MAXIMUM across every SIMULTANEOUS obligation — see this file's own header.
  const winning = rules.reduce((longest, rule) => (rule.years > longest.years ? rule : longest));
  const others = rules.filter((rule) => rule !== winning);

  const retentionBasis =
    others.length === 0
      ? `${describeRule(winning)}.`
      : `${describeRule(winning)} — the longer of ${rules.length} obligations that apply ` +
        `simultaneously to the same company: ${rules.map(describeRule).join('; ')}.`;

  return { retentionUntil: addYears(archivedAt, winning.years), retentionBasis };
}
