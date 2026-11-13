/**
 * The hosted-billing lifecycle's own PURE decisions — split from `billing-lifecycle-sweep-runner.ts`
 * (the Prisma/BullMQ/mail-touching half) for the exact reason `currency-rate-sweep.ts` is split
 * from `currency-rate-sweep-runner.ts` (that file's own header): a state transition is a plain
 * function of facts already in hand, testable without a broker, an HTTP call, or a database.
 *
 * ## The two cycles this drives (product decision, 2026-09-15)
 *
 *  1. NEVER-PAID: `trial` (14 days, EVERYTHING allowed except actually sending — see
 *     `send-gate.ts#assertCanSend`) --[trialEndsAt reached]--> `blocked` (14 days, read-only, every
 *     action refused) --[14 days elapse]--> zip sent, `zipped` --[30 days elapse]--> deleted.
 *  2. PAID-THEN-STOPPED: `active` --[the payment provider reports the subscription stopped renewing]-->
 *     `past_due` --[the period the company had ALREADY PAID FOR runs out — see below]--> `blocked`
 *     (14 days) --[14 days elapse]--> zip sent, `zipped` --[180 days elapse]--> deleted.
 *
 * `active` itself is never advanced by this function - becoming `active`/`past_due` is a fact the
 * payment provider reports (Stripe subscription events, through the Better Auth Stripe plugin), not
 * something a periodic sweep can observe on its own; this function only walks a subscription FORWARD
 * once it is already in `trial`, `past_due`, `blocked`, or `zipped`.
 *
 * `past_due` carries no grace window OF ITS OWN (the product brief never named one — the moment payment
 * stops, this treats it as already inside the SAME 14-day countdown the never-paid cycle uses, never
 * a separate/longer grace period a company could exploit by design ambiguity). What it does carry is
 * whatever the company ALREADY BOUGHT: the read-only suspension opens when a paid subscription ENDS
 * (Terms of Service, Section 13.1(b)) — "through cancellation taking effect, non-renewal, or an
 * unresolved payment failure" — and a period paid through the 31st has not ended on the 3rd merely
 * because that month's renewal was refused and the provider is still retrying it. So `past_due` folds into
 * `blocked` on the first tick at or after the end of the period on file (`currentPeriodEnd`, read
 * through `paid-period-grace.ts#isPaidPeriodStillRunning` — the same "a period already paid for is not
 * shortened by something the customer never agreed to" commitment Section 20.2 makes for a Terms
 * change), `blockedAt` stamped `now`, and on the very next tick for a company with no paid period on
 * file at all (a checkout that never completed, a trial that lapsed straight into `past_due`).
 *
 * ## Distinguishing the two cycles' zip→delete delay WITHOUT a dedicated field
 * Both cycles fold into `blocked` and then `zipped` through IDENTICAL code, but the grace period
 * after the zip is sent differs (see the enum's own two cases above). `CompanySubscription.firstPaidAt`
 * is what tells them apart: stamped once, the first time a subscription is paid for, and NEVER cleared
 * afterward, even once the subscription itself is later canceled. So "has this company ever actually
 * paid" is exactly `firstPaidAt !== null`.
 */
// The only import this otherwise dependency-free module takes, and deliberately so: "when does the
// period a company already paid for stop protecting it" is ONE definition, shared with the Terms
// exception that asks the same question for its own reason (`paid-period-grace.ts`'s own header). That
// file is equally pure — no Prisma client, no clock of its own — so importing it costs this module
// none of the testability the split above exists for.
import { isPaidPeriodStillRunning } from './paid-period-grace';

/** Mirrors the Prisma `CompanySubscriptionStatus` enum's own member names exactly (SCREAMING_SNAKE,
 *  the convention every other enum in `schema.prisma` already uses — `CompanyRole`,
 *  `BankStatementLineStatus`…) so this pure module and the generated client agree on the SAME string
 *  values with no translation layer at the boundary. */
export type CompanySubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'BLOCKED' | 'ZIPPED' | 'DELETED';

/** Every fact `computeLifecycleTransition` needs — a narrow projection of `CompanySubscription`
 *  (never the whole Prisma row), so a spec can build one by hand without touching a database. */
export interface CompanySubscriptionLifecycleFacts {
  status: CompanySubscriptionStatus;
  trialEndsAt: Date;
  blockedAt: Date | null;
  zipSentAt: Date | null;
  deletionDueAt: Date | null;
  /** See this file's own header — the ONLY signal distinguishing the two cycles' zip→delete delay. */
  firstPaidAt: Date | null;
  /** The end of the period this company has ALREADY PAID FOR, as last mirrored while the subscription
   *  was live. It is only ever written from a fact that still reports the subscription as paid, so it
   *  can never quietly become the end of an UNPAID cycle the provider rolled the company into on a
   *  failed renewal. `null` for a company that has never paid for one - read only by the `PAST_DUE`
   *  branch below. */
  currentPeriodEnd: Date | null;
}

export const TRIAL_DAYS = 14;
export const BLOCKED_DAYS = 14;
/** Floor on how soon ANY company — paid or not — may be permanently deleted once its archive has been
 *  emailed out: a company must stay able to retrieve what it was sent for at least this long before
 *  erasure, and that minimum does not turn on whether the company ever paid. A never-paid company gets
 *  exactly this many days, never zero; a paid-then-stopped one still gets the much longer
 *  `PAID_ZIP_GRACE_DAYS` below (a product choice, well past this floor, not the floor itself). */
export const MIN_RETRIEVAL_DAYS = 30;
/** Grace period between a PAID company's zip being sent and its real deletion — see
 *  `MIN_RETRIEVAL_DAYS` above for the shorter floor a never-paid company gets instead. */
export const PAID_ZIP_GRACE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export type LifecycleAction =
  /** Nothing to do this tick — the common case; most subscriptions sit in `active` or mid-window. */
  | { type: 'none' }
  /** `trial` (its 14 days elapsed) or `past_due` (no window of its own — see header) enters `blocked`. */
  | { type: 'enter_blocked'; blockedAt: Date }
  /** `blocked`'s own 14 days elapsed: the runner sends the zip, THEN this transition is applied —
   *  `deletionDueAt` is computed here (pure) so the runner never re-derives the "which cycle" logic
   *  itself; it only ever reads this field. */
  | { type: 'send_zip_and_enter_zipped'; zipSentAt: Date; deletionDueAt: Date }
  /** `zipped`'s own grace period elapsed: the runner performs the real, cascading deletion. See
   *  `deletion.ts`'s own header for why no row is ever actually persisted with `status: 'deleted'` —
   *  deleting the `Company` row cascades away its own `CompanySubscription` row in the same breath. */
  | { type: 'delete_company' };

/**
 * One pure step. Never mutates `sub`, never reads the clock itself (`now` is always the caller's) —
 * every day-boundary in this file's own header is a `<`/`>=` this function alone decides, proven
 * exhaustively by `lifecycle.spec.ts` at each boundary, for BOTH cycles.
 */
export function computeLifecycleTransition(
  sub: CompanySubscriptionLifecycleFacts,
  now: Date,
): LifecycleAction {
  switch (sub.status) {
    case 'TRIAL':
      return now.getTime() >= sub.trialEndsAt.getTime()
        ? { type: 'enter_blocked', blockedAt: now }
        : { type: 'none' };

    case 'PAST_DUE':
      // No grace window of its own — but never before the end of the period the company already paid
      // for (see this file's own header on Section 13.1(b)). `none` here is not "nothing is wrong": the
      // company keeps the access it bought while its Billing screen shows the failed payment and the
      // days it has left to fix it (`billing-status-view.ts`), which is exactly the window a card
      // decline needs and the old unconditional block never gave.
      if (isPaidPeriodStillRunning(sub.currentPeriodEnd, now)) return { type: 'none' };
      return { type: 'enter_blocked', blockedAt: now };

    case 'BLOCKED': {
      // Defensive: a `blocked` row must always carry `blockedAt` (set by the very transition that put
      // it there) — `null` here would mean a row was written by hand or by a bug, never by this code.
      if (sub.blockedAt === null) return { type: 'none' };
      const zipDueAt = addDays(sub.blockedAt, BLOCKED_DAYS);
      if (now.getTime() < zipDueAt.getTime()) return { type: 'none' };
      const deletionDueAt =
        sub.firstPaidAt !== null ? addDays(now, PAID_ZIP_GRACE_DAYS) : addDays(now, MIN_RETRIEVAL_DAYS);
      return { type: 'send_zip_and_enter_zipped', zipSentAt: now, deletionDueAt };
    }

    case 'ZIPPED': {
      if (sub.deletionDueAt === null) return { type: 'none' };
      return now.getTime() >= sub.deletionDueAt.getTime() ? { type: 'delete_company' } : { type: 'none' };
    }

    case 'ACTIVE':
    case 'DELETED':
      // `active`: only a webhook moves this forward (see header). `deleted`: terminal, the row is
      // gone by construction (see `send_zip_and_enter_zipped`'s own comment) — reaching this case at
      // all would mean a caller re-read a row this same sweep should have deleted.
      return { type: 'none' };
  }
}

/** The trial window a brand-new `CompanySubscription` gets — `trialStartedAt`/`trialEndsAt` at the
 *  moment of lazy creation (`company-subscription.store.ts#getOrCreateCompanySubscription`). Pulled
 *  out as its own function so both the store and its spec share exactly one definition of "14 days". */
export function computeTrialWindow(startedAt: Date): { trialStartedAt: Date; trialEndsAt: Date } {
  return { trialStartedAt: startedAt, trialEndsAt: addDays(startedAt, TRIAL_DAYS) };
}

/**
 * OWNER warning-email milestones (product decision) — J-7 and J-1 ahead of each of the TWO moments
 * `lifecycle.ts`'s own transitions above compute, so the OWNER never finds out about the zip or the
 * permanent deletion only once it has already happened:
 *  - `blocked_d7`/`blocked_d1`: 7 and 1 day(s) before `BLOCKED`'s own `send_zip_and_enter_zipped`
 *    transition (day 7 and day 13 of the 14-day BLOCKED window).
 *  - `zipped_d7`/`zipped_d1`: 7 and 1 day(s) before `ZIPPED`'s own `delete_company` transition,
 *    counted back from `deletionDueAt` directly (rather than re-deriving it) — `deletionDueAt` is
 *    already the one fact that correctly distinguishes the never-paid (`MIN_RETRIEVAL_DAYS`, 30 days)
 *    from the paid-then-stopped (`PAID_ZIP_GRACE_DAYS`, 180 days) cycle, so both get their own
 *    milestones computed the exact same way with no extra branching here.
 */
export type BillingWarningMilestone = 'blocked_d7' | 'blocked_d1' | 'zipped_d7' | 'zipped_d1';

export interface BillingWarningFacts {
  status: CompanySubscriptionStatus;
  blockedAt: Date | null;
  zipSentAt: Date | null;
  deletionDueAt: Date | null;
}

/**
 * Every milestone whose OWN threshold has been reached as of `now` — independently of one another
 * (never `else if`), so a sweep tick that was missed still catches up on BOTH once it finally runs,
 * each checked against the caller's own "already sent" set before actually mailing anything
 * (`billing-lifecycle-sweep-runner.ts`'s own idempotency, `CompanySubscription.billingWarningMilestonesSent`).
 * Pure, and — like `computeLifecycleTransition` above — never reads the clock itself.
 *
 * `zipped_d7`/`zipped_d1` additionally require a REAL grace window (`deletionDueAt` at least 7 days
 * after `zipSentAt`) — both cycles legitimately clear this today (`MIN_RETRIEVAL_DAYS` and
 * `PAID_ZIP_GRACE_DAYS` are each well past a week), so this guard is a defensive invariant rather than
 * the thing telling the two cycles apart: without it, a row somehow written with a shorter window
 * would read both milestones as trivially "due" the instant ZIPPED is entered, moments before
 * `delete_company` fires — a warning promising "N days left" when there are none left is worse than no
 * warning at all.
 */
export function computeDueBillingWarnings(sub: BillingWarningFacts, now: Date): BillingWarningMilestone[] {
  const due: BillingWarningMilestone[] = [];

  if (sub.status === 'BLOCKED' && sub.blockedAt) {
    if (now.getTime() >= addDays(sub.blockedAt, 7).getTime()) due.push('blocked_d7');
    if (now.getTime() >= addDays(sub.blockedAt, BLOCKED_DAYS - 1).getTime()) due.push('blocked_d1');
  }

  const hasRealZippedGraceWindow =
    sub.status === 'ZIPPED' &&
    sub.zipSentAt !== null &&
    sub.deletionDueAt !== null &&
    sub.deletionDueAt.getTime() - sub.zipSentAt.getTime() >= 7 * DAY_MS;

  if (hasRealZippedGraceWindow && sub.deletionDueAt) {
    if (now.getTime() >= addDays(sub.deletionDueAt, -7).getTime()) due.push('zipped_d7');
    if (now.getTime() >= addDays(sub.deletionDueAt, -1).getTime()) due.push('zipped_d1');
  }

  return due;
}
