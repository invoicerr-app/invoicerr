/**
 * The hosted-billing lifecycle's own PURE decisions — split from `billing-lifecycle-sweep-runner.ts`
 * (the Prisma/BullMQ/Polar/mail-touching half) for the exact reason `currency-rate-sweep.ts` is split
 * from `currency-rate-sweep-runner.ts` (that file's own header): a state transition is a plain
 * function of facts already in hand, testable without a broker, an HTTP call, or a database.
 *
 * ## The two cycles this drives (product decision, 2026-09-15)
 *
 *  1. NEVER-PAID: `trial` (14 days, EVERYTHING allowed except actually sending — see
 *     `send-gate.ts#assertCanSend`) --[trialEndsAt reached]--> `blocked` (14 days, read-only, every
 *     action refused) --[14 days elapse]--> zip sent, `zipped` --[next sweep tick]--> deleted.
 *  2. PAID-THEN-STOPPED: `active` --[Polar webhook reports the subscription stopped renewing]-->
 *     `past_due` --[the very next sweep tick, no separate grace window of its own — see below]-->
 *     `blocked` (14 days) --[14 days elapse]--> zip sent, `zipped` --[180 days elapse]--> deleted.
 *
 * `active` itself is never advanced by this function — becoming `active`/`past_due` is a WEBHOOK
 * fact (`webhook-handlers.ts`, `subscription.active` / `subscription.canceled` / `.revoked`), not
 * something a periodic sweep can observe on its own; this function only walks a subscription FORWARD
 * once it is already in `trial`, `past_due`, `blocked`, or `zipped`.
 *
 * `past_due` carries no duration of its own (the product brief never named one — the moment payment
 * stops, this treats it as already inside the SAME 14-day countdown the never-paid cycle uses, never
 * a separate/longer grace period a company could exploit by design ambiguity) — so `past_due` folds
 * straight into `blocked` on the very next tick, `blockedAt` stamped `now`.
 *
 * ## Distinguishing the two cycles' zip→delete delay WITHOUT a dedicated field
 * Both cycles fold into `blocked` and then `zipped` through IDENTICAL code, but the grace period
 * after the zip is sent differs (see the enum's own two cases above) — and rather than adding an
 * `everPaid: boolean` this repurposes a fact already on `CompanySubscription`: `polarSubscriptionId`
 * is set exactly once, the moment a checkout completes (`webhook-handlers.ts`), and — like every
 * other id this codebase persists — is NEVER cleared afterward, even once the subscription itself is
 * later canceled/revoked. So "has this company ever actually paid" is exactly
 * `polarSubscriptionId !== null`, with no new column and no way for the two facts to drift apart.
 */

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
  polarSubscriptionId: string | null;
}

export const TRIAL_DAYS = 14;
export const BLOCKED_DAYS = 14;
/** Grace period between a PAID company's zip being sent and its real deletion. A never-paid company
 *  gets none (see `LifecycleAction`'s own `send_zip_and_enter_zipped` case below) — deliberate, see
 *  this file's own header. */
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
      // No window of its own — see this file's own header. Folds straight into `blocked`.
      return { type: 'enter_blocked', blockedAt: now };

    case 'BLOCKED': {
      // Defensive: a `blocked` row must always carry `blockedAt` (set by the very transition that put
      // it there) — `null` here would mean a row was written by hand or by a bug, never by this code.
      if (sub.blockedAt === null) return { type: 'none' };
      const zipDueAt = addDays(sub.blockedAt, BLOCKED_DAYS);
      if (now.getTime() < zipDueAt.getTime()) return { type: 'none' };
      const deletionDueAt = sub.polarSubscriptionId !== null ? addDays(now, PAID_ZIP_GRACE_DAYS) : now;
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
 *    counted back from `deletionDueAt` directly (rather than re-deriving it) since that field is
 *    already the one fact that correctly distinguishes the never-paid (no grace at all — see
 *    `deletionDueAt`'s own comment above) from the paid-then-stopped (180-day grace) cycle: a
 *    never-paid company's `deletionDueAt` equals its own `zipSentAt`, so `zipped_d7`/`zipped_d1` never
 *    become due for it (there is no 7-or-1-day window to warn inside), which is correct — it was
 *    already warned twice, at `blocked_d7`/`blocked_d1`, and the zip mail itself doubles as its own
 *    final notice.
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
 * after `zipSentAt`) — a never-paid company's `deletionDueAt` equals its own `zipSentAt` (no grace at
 * all, see this file's own header), so without this guard both would read as trivially "due" the
 * instant ZIPPED is entered, moments before `delete_company` fires on the very next tick — a warning
 * promising "N days left" when there are none is worse than no warning at all.
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
