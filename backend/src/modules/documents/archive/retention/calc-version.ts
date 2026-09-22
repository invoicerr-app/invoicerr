/**
 * The retention CALCULATION version — a provenance marker for `DocumentArchive.retentionCalcVersion`
 * (`schema.prisma`), written once per row at archive-creation time, never touched again. Exists
 * because of a real incident: `cf2e7323` fixed `compute-retention.ts` to count each rule's duration
 * from what the cited statute actually says (`RetentionOrigin`) instead of always from `archivedAt` —
 * a defect that made every previously-written `retentionUntil` up to a year too EARLY, the dangerous
 * direction (see that commit and `compute-retention.ts`'s own header). No migration recomputes the
 * existing rows: an archive record is a record, and a version upgrade rewriting one — on this install
 * or on any third-party self-hosted one — is not a thing this product does. The UI marks the rows
 * carrying the old, possibly-wrong calculation instead, and this file is the discriminator it needs.
 *
 * ## Why `retentionBasis`'s own TEXT was checked FIRST, and rejected
 *
 * The cheapest possible discriminator would need no new column at all: if the OLD code's
 * `retentionBasis` string were reliably distinguishable from the NEW code's, that string — already
 * sitting on every row — would be enough. It is not. Compared byte-for-byte
 * (`git show cf2e7323^:.../compute-retention.ts` against the current file):
 *
 *  - `describeRule` is IDENTICAL in both versions: `` `${rule.label} ${rule.years}y (${rule.legalRef})` ``.
 *  - The single-rule case renders identically: `` `${describeRule(winning)}.` `` in both.
 *  - The multi-rule case renders identically TEXT-WISE when every rule resolves (the normal case, a
 *    document with an issue date): old writes
 *    `` `${describeRule(winning)} — the longer of ${rules.length} obligations that apply
 *    simultaneously to the same company: ${rules.map(describeRule).join('; ')}.` ``, new writes the
 *    same template over `resolved` instead of `rules` — but `resolved.length === rules.length` and
 *    `resolved.map(r => r.rule)` is the same list as `rules` whenever nothing needed to be dropped for
 *    a missing issue date, so the two strings are character-for-character equal.
 *  - The "no rule declared for this country" case is identical text in both.
 *
 *  What differs is which rule WINS: old picks `rules.reduce(max by .years)`; new picks
 *  `resolved.reduce(max by computed .until)`. These CAN disagree in principle (the new file's own
 *  header: "a shorter duration counted from an EARLIER origin can still land later"). Checked against
 *  every country file that exists today (`data/*.json`):
 *   - FR: fiscal 6y from `issueDate` vs commercial 10y from `fiscalYearEndUnknownSafe`
 *     (`issueDate` + 1y). Old wins on years (10 > 6). New compares dates: `issueDate+1y+10y` = `+11y`
 *     vs `issueDate+6y` — commercial still wins. Same winner, same text.
 *   - DE: two 8y rules, both `issueDateYearEnd` — identical years AND origin, no possible disagreement.
 *   - PL, PT: exactly one rule each — no "winner" to disagree about.
 *  So for every rule this product has actually sourced, the OLD and NEW algorithms produce the exact
 *  same `retentionBasis` string whenever a document's issue date was available (the ordinary case —
 *  the one case a real archive is written under). Text alone would either flag nothing (matching on a
 *  divergence that never occurs in practice) or, if matched more loosely, risk flagging a row that was
 *  computed correctly. That false positive is the worse of the two errors: a warning shown on a row
 *  that is in fact correct teaches the reader to ignore the warning, and the rows it exists to protect
 *  go with it. Text is therefore not an acceptable discriminator, hence this column.
 *
 * ## Why an integer, not a boolean
 *
 * `computeRetention`'s own origin axis is not expected to be the last correction this file ever needs
 * — a future fix (a new `RetentionOrigin`, a different winner rule, a bug in `addYears` itself) would
 * face the exact same problem this one did: rows written under the old behaviour, indistinguishable by
 * their own text. An incrementing version lets a future fix bump `CURRENT_RETENTION_CALC_VERSION`
 * again and keep the same "NULL / lower version number ⇒ show the stale notice" rule the UI already
 * has, rather than inventing a second boolean column for the next incident.
 *
 * ## Why this lives here and not in `compute-retention.ts`
 *
 * `compute-retention.ts` is correct as it stands, and this marker deliberately does not touch it.
 * The version number is not part of WHAT a retention duration is computed as; it is metadata about
 * WHICH WRITE produced the row, a concern of `persistence.ts` (the only caller that writes a
 * `DocumentArchive` row), kept in its own file so it is obviously not something
 * `compute-retention.spec.ts`'s own suite needs to know about.
 */

/**
 * Bump this — and ONLY this — the next time `compute-retention.ts`'s algorithm changes in a way that
 * could move a previously-computed `retentionUntil` (a new `RetentionOrigin` interpretation, a
 * different winner-selection rule, an arithmetic fix). Every row written under the OLD value stays
 * exactly as it was written (see `schema.prisma`'s own comment on `retentionCalcVersion`: no
 * migration ever rewrites it) — bumping this only changes what NEW rows record, and what the UI
 * therefore treats as "known current" versus "possibly stale".
 *
 * BUMPED TO 2: `compute-retention.ts#endOfYearUtc` used to anchor on MIDNIGHT AT THE START of 31
 * December instead of its last instant (23:59:59.999) — every rule using `issueDateYearEnd` (DE ×2,
 * PT) or `taxDeadlineYearEndUnknownSafe` (PL) resolved a `retentionUntil` a full day too EARLY, the
 * same dangerous direction v1 itself was created to fix. Rows written under v1 stay exactly as they
 * were computed; only a NEW write records v2 and gets the corrected, one-day-later value.
 */
export const CURRENT_RETENTION_CALC_VERSION = 2;
