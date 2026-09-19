import { computeRetention } from './compute-retention';
import { ALL_RETENTION_FILES } from './data/all';
import { CountryRetentionFile, RetentionRule } from './schema';

/**
 * Proves the claim `calc-version.ts`'s own header makes by inspection: that `retentionBasis`'s TEXT
 * cannot tell the OLD (pre-`cf2e7323`) algorithm apart from the current one, even though the DATE it
 * computes can genuinely differ — which is exactly why `retentionCalcVersion` (a real column, not a
 * text heuristic) had to exist at all.
 *
 * `oldComputeRetention` below is transcribed VERBATIM from
 * `git show cf2e7323^:backend/src/modules/documents/archive/retention/compute-retention.ts` (the file
 * as it stood immediately before the origin-axis fix) — never re-derived from memory, so this
 * comparison is against what actually shipped, not an approximation of it.
 */
function oldDescribeRule(rule: RetentionRule): string {
  return `${rule.label} ${rule.years}y (${rule.legalRef})`;
}

function oldAddYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function oldComputeRetention(
  file: CountryRetentionFile | undefined,
  archivedAt: Date,
): { retentionUntil: Date | null; retentionBasis: string } {
  const rules = file?.rules ?? [];
  if (rules.length === 0) {
    return {
      retentionUntil: null,
      retentionBasis: file
        ? `No retention rule declared for ${file.countryCode} — no duration invented.`
        : 'No retention rule declared for this country — no duration invented.',
    };
  }
  const winning = rules.reduce((longest, rule) => (rule.years > longest.years ? rule : longest));
  const others = rules.filter((rule) => rule !== winning);
  const retentionBasis =
    others.length === 0
      ? `${oldDescribeRule(winning)}.`
      : `${oldDescribeRule(winning)} — the longer of ${rules.length} obligations that apply ` +
        `simultaneously to the same company: ${rules.map(oldDescribeRule).join('; ')}.`;
  return { retentionUntil: oldAddYears(archivedAt, winning.years), retentionBasis };
}

describe('retentionBasis text: OLD vs NEW algorithm, over every real country file that exists today', () => {
  // The REALISTIC case: a document is archived shortly after it is issued (`archive-on-send.ts`
  // writes the archive as part of the same "send" action that stamps the issue date) — issueDate just
  // a few days before archivedAt, never far apart. This is deliberately NOT a worst-case pick: it is
  // the ordinary shape of a real row, and the ONLY case worth comparing (the OLD algorithm has no
  // "issue date missing" branch to compare against at all).
  const issueDate = new Date('2026-09-10T00:00:00.000Z');
  const archivedAt = new Date('2026-09-13T12:00:00.000Z');

  it.each(
    ALL_RETENTION_FILES.map((file) => [file.countryCode, file] as const),
  )('%s: same retentionBasis text either way (text is NOT a usable discriminator)', (_code, file) => {
    const oldResult = oldComputeRetention(file, archivedAt);
    const newResult = computeRetention(file, archivedAt, issueDate);

    expect(newResult.retentionBasis).toBe(oldResult.retentionBasis);
  });

  it('FR: the computed DATE nonetheless differs between the two algorithms — a real defect, invisible in the text', () => {
    const fr = ALL_RETENTION_FILES.find((f) => f.countryCode === 'FR');
    expect(fr).toBeDefined();

    const oldResult = oldComputeRetention(fr, archivedAt);
    const newResult = computeRetention(fr, archivedAt, issueDate);

    // Same citation, same winning rule name ("commerciale 10y") — but the OLD date is anchored on
    // `archivedAt` (2026-09-13 + 10y = 2036-09-13) while the NEW one is anchored on the statute's own
    // origin (`issueDate` + 1y "fiscalYearEndUnknownSafe" + 10y = 2037-09-10) — about a YEAR later.
    // Read the other way round: the OLD row's `retentionUntil` told a company it could destroy this
    // document on 2036-09-13, roughly a year before the law (per the corrected reading) actually
    // allows it to — exactly the dangerous direction `cf2e7323` fixed, and exactly what
    // `retentionBasis`'s own text never reveals.
    expect(newResult.retentionBasis).toBe(oldResult.retentionBasis);
    expect(newResult.retentionUntil?.toISOString()).not.toBe(oldResult.retentionUntil?.toISOString());
    expect(newResult.retentionUntil!.getTime()).toBeGreaterThan(oldResult.retentionUntil!.getTime());
  });
});
