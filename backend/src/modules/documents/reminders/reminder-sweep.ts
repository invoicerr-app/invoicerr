/**
 * The dunning-reminder sweep's own PURE decisions — split from reminder-sweep-runner.ts (the
 * Prisma/BullMQ/mail-touching half) for the exact reason `conformity-sweep.ts`/`currency-rate-sweep.ts`
 * are split from their own runners: "which tier is this invoice due for" and "what does that tier's
 * email say" are both plain functions of data already in hand, testable without a broker, a database,
 * or an SMTP server (reminder-sweep.spec.ts).
 *
 * ## Scope: OVERDUE INVOICES ONLY
 *
 * The feature's own description also names unsigned quotes as a candidate for the same escalating-
 * reminder treatment — deliberately NOT built here (exactly the scope creep to avoid). Nothing below
 * hardcodes "invoice" though: `selectDueReminderTier` only ever takes
 * a `daysOverdue` number and a set of already-sent tiers, and `buildReminderEmail` only ever takes
 * plain display facts (a number, an amount, a date) — a later "quote missing a signature N days after
 * being sent" variant needs only a second overdue-candidate query in reminder-sweep-runner.ts (its own
 * `findOverdueInvoiceCandidates`'s sibling), feeding this SAME tier-selection/copy engine, never a
 * second one.
 *
 * ## ONE sweep, not one repeatable per company/invoice — same reasoning as the other three sweeps
 *
 * Exactly one repeatable job (`REMINDER_SWEEP_JOB_NAME`, registered by
 * `queue/document-queue.dispatcher.ts`'s own `registerReminderSweepRepeatable`, on
 * `readReminderSweepIntervalMs()`, default 24h) walks every OPTED-IN company's own overdue invoices
 * each pass. `DocumentReminder` rows (schema.prisma) are the only durable state the sweep needs — the
 * repeatable is just a metronome, the same division `conformity-sweep.ts`'s own header already
 * documents at length for its own mechanism. A daily cadence, specifically: reminders escalate in
 * whole DAYS overdue (`daysOverdueOn` below), so sweeping more than once a day can never observe a
 * different tier for the same invoice — the exact cadence argument `currency-rate-sweep.ts`'s own
 * header makes for the ECB feed's own once-a-business-day publication.
 *
 * ## Tier selection — see `selectDueReminderTier` below
 *
 * `REMINDER_TIERS` is ascending and fixed (7/14/30 days overdue, the feature's own example set).
 * Per invoice per pass, this picks the LOWEST tier that is BOTH due
 * (`daysOverdue >= tier.daysOverdue`) AND not yet sent — never the highest: an invoice nobody looked
 * at for 40 days must still climb 7 -> 14 -> 30, one email per day-crossing on successive daily runs,
 * never a burst of three at once the first time anyone looks. Returning on the FIRST ascending match
 * is what makes "at most one tier per call" — and therefore "at most one email per invoice per sweep
 * pass" (the sweep's own explicit rule) — true by construction, never an accident of the tiers
 * happening to be declared in order.
 */

export const REMINDER_SWEEP_JOB_NAME = 'document-reminder-sweep';
export const REMINDER_SWEEP_JOB_ID = 'document-reminder-sweep-singleton';

/** Default 24h (`86_400_000`ms) — see this file's own header, "ONE sweep..." section, for why more
 *  than once a day buys nothing: a tier is keyed on whole days overdue, so a second pass on the same
 *  calendar day can never find a NEW tier due that the first pass didn't already see. Mirrors
 *  `conformity-sweep.ts#readConformitySweepIntervalMs`'s exact shape (env var, base-10 `parseInt`,
 *  numeric fallback) — same convention, different cadence. */
export function readReminderSweepIntervalMs(): number {
  return parseInt(process.env.DOCUMENT_REMINDER_SWEEP_INTERVAL_MS ?? `${24 * 60 * 60 * 1000}`, 10);
}

export interface ReminderTier {
  /** Both the threshold ("at least this many whole days overdue") AND the exact value stored,
   *  verbatim, in `DocumentReminder.tier` — one number identifies "which tier" everywhere: selection
   *  below, the idempotency row (schema.prisma), and this tier's own copy (`buildReminderEmail`
   *  below). */
  daysOverdue: number;
}

/** Ascending, fixed, three steps — the feature's own example set ("7, 14, 30 jours").
 *  Extending the escalation later (a fourth tier, a different cadence) is exactly one more entry
 *  here, kept in ascending order (`selectDueReminderTier` below relies on that order to return the
 *  LOWEST due tier first) — plus one more `case` in `buildReminderEmail`'s own switch; nothing else in
 *  this file names 7/14/30 anywhere but these two places. */
export const REMINDER_TIERS: readonly ReminderTier[] = [
  { daysOverdue: 7 },
  { daysOverdue: 14 },
  { daysOverdue: 30 },
];

/**
 * Whole UTC days between `dueDate` and `asOf` — the IDENTICAL arithmetic
 * `settlement/client-statement.ts#resolveAgingBucket` already uses (UTC-midnight both sides,
 * `Math.floor`), copied rather than imported: that function collapses the count into a coarse BUCKET
 * ('current'/'0-30'/…) for a statement screen, this one needs the exact day COUNT to compare against
 * a tier threshold — two different shapes over the same one fact, not worth forcing a shared return
 * type for. Returns `null`, never a guessed number, for a missing/unparseable `dueDate` — an invoice's
 * own `dueDate` field is required, so this should never actually happen in practice
 * (reminder-sweep-runner.ts's own candidate query only ever reads real invoice data), but a data
 * anomaly must still degrade rather than crash, the same "honest null, never a guess" rule
 * `resolveAgingBucket` itself already holds.
 */
export function daysOverdueOn(dueDate: string | null | undefined, asOf: Date): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;

  const dueUtcMs = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const asOfUtcMs = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.floor((asOfUtcMs - dueUtcMs) / 86_400_000);
}

/**
 * The lowest tier that is both DUE (`daysOverdue >= tier.daysOverdue`) and NOT already present in
 * `sentTiers` — or `null` if none qualifies (not yet 7 days overdue at all, or every due tier has
 * already been sent). See this file's own header, "Tier selection", for why iterating
 * `REMINDER_TIERS` in its own ascending order and returning on the FIRST match is what guarantees "at
 * most one tier, ever" from a single call.
 */
export function selectDueReminderTier(daysOverdue: number, sentTiers: ReadonlySet<number>): number | null {
  for (const tier of REMINDER_TIERS) {
    if (daysOverdue >= tier.daysOverdue && !sentTiers.has(tier.daysOverdue)) {
      return tier.daysOverdue;
    }
  }
  return null;
}

/** Plain display facts `buildReminderEmail` composes from — plain data, never Prisma rows or a
 *  `DocumentInstance` directly: this file stays free of any persistence shape, the same "a pure
 *  function of data already in hand" discipline this file's own header states for the whole module. */
export interface ReminderEmailContext {
  /** The invoice's own `displayNumber` (falls back to its raw id upstream — see
   *  reminder-sweep-runner.ts — for the never-actually-reachable case of a "sent" invoice somehow
   *  still unnumbered). */
  displayNumber: string;
  /** Already formatted with the document's own currency and decimal places (e.g. "1234.56 EUR") —
   *  this file never touches money math, the same "never recompute a balance here" rule this whole
   *  feature's own brief states; `reminder-sweep-runner.ts` formats it once, with
   *  `@/utils/financial`'s `fromMinor`/`decimalsFor`, the same helper `compute-settlement.ts#describeSettlement`
   *  already uses for an identical purpose. */
  amountOutstanding: string;
  /** The invoice's own `dueDate`, verbatim (its stored `YYYY-MM-DD` string) — never reformatted here. */
  dueDate: string;
  daysOverdue: number;
  /** The issuing company's own display name — signs the email, never a generic "Invoicerr" sender. */
  companyName: string;
}

export interface ReminderEmailContent {
  subject: string;
  text: string;
}

/**
 * One escalating subject/body per tier — THE one place this feature's copy lives (this file's own
 * header: backend-generated email content, not a frontend screen, so it does NOT go through `t()`/
 * `locales/en/translation.json`, which only covers the SPA's own strings). A plain switch over the
 * SAME `tierDaysOverdue` value `selectDueReminderTier` returns and `DocumentReminder.tier` stores —
 * never a second, independent "tone" enum that could drift out of sync with `REMINDER_TIERS` above.
 */
export function buildReminderEmail(tierDaysOverdue: number, ctx: ReminderEmailContext): ReminderEmailContent {
  const { displayNumber, amountOutstanding, dueDate, daysOverdue, companyName } = ctx;

  switch (tierDaysOverdue) {
    case 7:
      return {
        subject: `Payment reminder — invoice ${displayNumber}`,
        text:
          `Hello,\n\n` +
          `This is a friendly reminder that invoice ${displayNumber}, for ${amountOutstanding}, was due ` +
          `on ${dueDate} and is now ${daysOverdue} day(s) overdue.\n\n` +
          `Please arrange payment at your earliest convenience. If you have already paid, please ` +
          `disregard this message.\n\n` +
          `Thank you,\n${companyName}`,
      };
    case 14:
      return {
        subject: `Second reminder — invoice ${displayNumber} is overdue`,
        text:
          `Hello,\n\n` +
          `Invoice ${displayNumber}, for ${amountOutstanding}, was due on ${dueDate} and is now ` +
          `${daysOverdue} day(s) overdue. This is our second reminder — please settle it as soon as ` +
          `possible.\n\n` +
          `If you are experiencing difficulty paying, please contact us so we can find a solution ` +
          `together.\n\n` +
          `${companyName}`,
      };
    case 30:
      return {
        subject: `URGENT — invoice ${displayNumber} is significantly overdue`,
        text:
          `Hello,\n\n` +
          `Invoice ${displayNumber}, for ${amountOutstanding}, was due on ${dueDate} and is now ` +
          `${daysOverdue} day(s) overdue. Despite our previous reminders, it remains unpaid.\n\n` +
          `Please settle this invoice IMMEDIATELY to avoid further action. Contact us urgently if there ` +
          `is a dispute, or a difficulty we are not yet aware of.\n\n` +
          `${companyName}`,
      };
    default:
      // Unreachable in production — `tierDaysOverdue` only ever comes from `selectDueReminderTier`,
      // which only ever returns a value present in `REMINDER_TIERS` above. A loud, named failure
      // rather than a silently blank email if this file's own tier set and this switch ever drift
      // apart (e.g. a tier added to one but not the other).
      throw new Error(`No reminder email copy defined for tier ${tierDaysOverdue} days overdue.`);
  }
}
