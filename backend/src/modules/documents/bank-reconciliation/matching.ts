/**
 * Suggests which OUTSTANDING invoice(s) a bank statement line might be paying — pure and Prisma-free,
 * the same "pure builder, impure caller" split `settlement/compute-settlement.ts`/
 * `accounting-export/build-accounting-csv.ts` already hold: `candidate-invoices.ts` gathers the pool,
 * `bank-reconciliation.service.ts` calls this per line, this file makes no query of its own.
 *
 * ## The matching rule
 * Amount alone is never enough — "two invoices for 120,00 €" is this feature's own worked example of
 * why. A candidate is SUGGESTED only when ALL of:
 *  1. the CURRENCY matches exactly — no FX guess is ever made to justify a match (a genuinely
 *     foreign-currency payment can still be reconciled BY HAND, through the exact same
 *     "record-payment" action a same-currency reconciliation uses — this function just never
 *     SUGGESTS one, since inventing a rate to justify a suggestion would be its own silent guess, the
 *     one thing `settlement/convert-payment.ts` already refuses to do for a real payment);
 *  2. the AMOUNT matches EXACTLY (`line.amountMinor === candidate.outstandingMinor`) — never a
 *     fuzzy/partial match: a partial payment is a real, recordable payment too, but it is for a human
 *     to pick deliberately, never for this function to guess which invoice a partial sum was
 *     "probably" meant for;
 *  3. AND AT LEAST ONE of:
 *     - the invoice's own `displayNumber` appears (alphanumerics only, case-insensitive) inside the
 *       line's `label` OR its own structured `reference` — the strongest signal: a human or an
 *       accounting system TYPED the invoice number into the transfer;
 *     - the line's date falls within a plausible window of the invoice's own dates — from
 *       `DAYS_BEFORE_ISSUE` days before it was issued (an advance/deposit-style payment) to
 *       `DAYS_AFTER_DUE` days after its due date (a genuinely late payer), anchored on `dueDate` when
 *       known, `issueDate` otherwise.
 * A candidate matching on amount but NEITHER signal is silently excluded, never suggested "just in
 * case" — the concrete rule behind this feature's own "the machine proposes, the human commits" line:
 * a suggestion is a claim this function is willing to make PLAINLY, not a hedge offered for safety.
 *
 * Several qualifying candidates for one line is the ORDINARY case, not an error (this feature's own
 * brief) — every one of them is returned, ranked (a reference match, or both signals together, ranks
 * above a date-window-only match), for a human to pick from. A line matching none is `[]`, equally
 * ordinary — the line stays UNMATCHED; nothing about a bank statement requires every line to end up
 * applied to an invoice (a bank fee, an owner's own transfer, a client's deposit for future work with
 * no invoice yet, are all real, permanently-unmatched rows — see this module's own
 * `BankStatementLineStatus.UNMATCHED` schema comment).
 */

export type MatchReason = 'reference' | 'date-window';

export interface MatchCandidateInvoice {
  documentId: string;
  displayNumber: string | null;
  clientLabel: string | null;
  currency: string;
  /** Always strictly positive — `candidate-invoices.ts` never yields a fully-settled invoice. */
  outstandingMinor: number;
  issueDate: string | null;
  dueDate: string | null;
}

export interface MatchSuggestion {
  documentId: string;
  displayNumber: string | null;
  clientLabel: string | null;
  outstandingMinor: number;
  reasons: MatchReason[];
}

export interface BankLineForMatching {
  amountMinor: number;
  currency: string;
  date: Date;
  label: string;
  reference: string | null;
}

/** How far BEFORE an invoice's own `issueDate` a line may still date and count as "in the window" —
 *  covers a deposit/advance paid ahead of (or the same day as) issuance. */
const DAYS_BEFORE_ISSUE = 30;
/** How far AFTER an invoice's own `dueDate` a line may still date — covers a genuinely late payer
 *  without stretching the window so wide it starts qualifying unrelated old invoices. */
const DAYS_AFTER_DUE = 90;
const MS_PER_DAY = 86_400_000;

function normalize(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function referenceAppears(candidate: MatchCandidateInvoice, line: BankLineForMatching): boolean {
  if (!candidate.displayNumber) return false;
  const needle = normalize(candidate.displayNumber);
  if (!needle) return false;
  return [line.label, line.reference ?? ''].some((haystack) => normalize(haystack).includes(needle));
}

function toUtcDayMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function withinDateWindow(candidate: MatchCandidateInvoice, line: BankLineForMatching): boolean {
  const issue = candidate.issueDate ? new Date(candidate.issueDate) : null;
  const due = candidate.dueDate ? new Date(candidate.dueDate) : null;
  if (!issue && !due) return false; // an honest "cannot judge" — never a guessed window.

  const lineDayMs = toUtcDayMs(line.date);
  const earliestMs = issue ? toUtcDayMs(issue) - DAYS_BEFORE_ISSUE * MS_PER_DAY : -Infinity;
  const anchorForLatest = due ?? issue!;
  const latestMs = toUtcDayMs(anchorForLatest) + DAYS_AFTER_DUE * MS_PER_DAY;
  return lineDayMs >= earliestMs && lineDayMs <= latestMs;
}

/** Ranks a reference match above a date-window-only one, and both signals together above either
 *  alone — see this file's own header on why a typed invoice number is the stronger claim. */
function scoreOf(suggestion: MatchSuggestion): number {
  let score = 0;
  if (suggestion.reasons.includes('reference')) score += 2;
  if (suggestion.reasons.includes('date-window')) score += 1;
  return score;
}

export function suggestMatches(
  line: BankLineForMatching,
  candidates: readonly MatchCandidateInvoice[],
): MatchSuggestion[] {
  // Only a credit (money-in) line is ever a matching candidate — a debit's negative amount can never
  // equal a candidate's strictly-positive `outstandingMinor` anyway, but this is stated explicitly
  // rather than left to follow incidentally from that arithmetic fact.
  if (line.amountMinor <= 0) return [];

  const suggestions: MatchSuggestion[] = [];

  for (const candidate of candidates) {
    if (candidate.currency !== line.currency) continue;
    if (candidate.outstandingMinor !== line.amountMinor) continue;

    const reasons: MatchReason[] = [];
    if (referenceAppears(candidate, line)) reasons.push('reference');
    if (withinDateWindow(candidate, line)) reasons.push('date-window');
    if (reasons.length === 0) continue;

    suggestions.push({
      documentId: candidate.documentId,
      displayNumber: candidate.displayNumber,
      clientLabel: candidate.clientLabel,
      outstandingMinor: candidate.outstandingMinor,
      reasons,
    });
  }

  return suggestions.sort((a, b) => scoreOf(b) - scoreOf(a));
}
