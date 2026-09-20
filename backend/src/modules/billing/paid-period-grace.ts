/**
 * Product/legal decision, 2026-09-20 (Terms of Service Section 20.2): a change to the Terms takes
 * effect immediately (`write-gate.ts`/`legal-acceptance.guard.ts`'s own pending-acceptance write
 * lockout applies as soon as the content hash changes) EXCEPT for a Company with a subscription period
 * already in progress — one that already paid for a stretch of time under the version of the Terms in
 * force when it paid keeps full use of the Service, writes included, for the whole of that period. A
 * unilateral later change cannot retroactively shorten what was already bought.
 *
 * The exception ends on the LATER of two dates, both stated in Section 20.2:
 *  (a) the first day of the calendar month following the change's publication — a single, predictable
 *      date every Company can be told and supported around, independent of when any one subscription
 *      happens to renew;
 *  (b) the paid period's own renewal date — so a period that runs past the calendar floor (an annual
 *      plan, or a monthly one that happens to renew late in the following month) is never cut short by
 *      the calendar date alone.
 *
 * Taking the LATER of the two, never the earlier: the point of both dates is to protect a period
 * actually paid for, so whichever protects it longer wins. This is deliberately never a shorter,
 * "earlier of the two" floor — that would let the calendar date cut a long-running (e.g. annual) period
 * short, exactly the harm Section 20.2 exists to prevent.
 *
 * `status === 'ACTIVE'` is a hard requirement, not merely the common case: it is what keeps this
 * exception from ever reopening writes for a Company already refused them for an unrelated reason —
 * `BLOCKED`/`ZIPPED` (the Section 13.1 non-payment suspension, `write-gate.ts`'s own gate on those two
 * statuses runs independently and first, but this is checked here too, defensively, rather than relying
 * on guard ordering alone) and `PAST_DUE` (a renewal payment already failed — by definition there is no
 * currently-paid-for period left to protect) all read as "no grace" through this one condition, with no
 * separate exclusion list to keep in sync. `TRIAL` reads the same way: the free trial is not a
 * subscription period paid for at all — Section 20.2 says as much by name.
 *
 * Re-derived fresh on every check from the CURRENT `status`/`currentPeriodEnd` (never a single grace
 * end date computed once and cached): a paid period that in fact ends EARLIER than the later of (a)/(b)
 * above (a cancellation lands, a renewal payment fails) loses ACTIVE status the moment Polar reports it
 * (`webhook-handlers.ts#applySubscriptionWebhook`), which immediately narrows this exception back down
 * to nothing for that Company — the computed date is only ever an upper bound on how long the paid
 * period can protect the Company, never a promise independent of the subscription actually staying paid
 * that long.
 */
import { CompanySubscriptionStatus } from '../../../prisma/generated/prisma/client';

/** The narrow slice of `CompanySubscription` this module needs — never the whole Prisma row, the same
 *  "pure function, plain projection" split `lifecycle.ts`'s own facts interfaces hold. */
export interface CompanySubscriptionPeriodFacts {
  status: CompanySubscriptionStatus;
  /** Polar's own `Subscription.currentPeriodEnd`, mirrored verbatim — `null` for a Company with no
   *  Polar subscription fact recorded yet (still `TRIAL`, or an `ACTIVE` row from before this column
   *  existed and no webhook has landed since). See `schema.prisma`'s own comment on this column for
   *  where it is written from. */
  currentPeriodEnd: Date | null;
}

/**
 * Midnight UTC on the first day of the calendar month AFTER `publishedAt` — UTC, not server-local time,
 * so this never depends on the deployment's own timezone (every other day-boundary computation in this
 * module, `lifecycle.ts`'s own `addDays` included, is similarly timezone-independent by construction).
 */
export function firstOfMonthFollowing(publishedAt: Date): Date {
  return new Date(Date.UTC(publishedAt.getUTCFullYear(), publishedAt.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * The instant a change PUBLISHED at `publishedAt` starts binding this Company, per Section 20.2 — or
 * `null` when this Company has no subscription period in progress for that Section to protect at all
 * (see this file's own header on why `status !== 'ACTIVE'` alone covers every such case). Never reads
 * the clock itself — `publishedAt` is always the caller's own fact (`LegalDocumentRelease.publishedAt`,
 * `legal-release-lookup.ts`), the same "pure, caller-supplied time" discipline `lifecycle.ts`'s own
 * `computeLifecycleTransition` holds for `now`.
 */
export function paidPeriodBindingDate(sub: CompanySubscriptionPeriodFacts, publishedAt: Date): Date | null {
  if (sub.status !== 'ACTIVE' || sub.currentPeriodEnd === null) return null;

  const floor = firstOfMonthFollowing(publishedAt);
  return sub.currentPeriodEnd.getTime() > floor.getTime() ? sub.currentPeriodEnd : floor;
}

/**
 * True while `now` has not yet reached the binding date above — i.e. the pending-acceptance write
 * lockout `legal-acceptance.guard.ts` would otherwise apply immediately is deferred for this Company.
 * `false` (never exempted) for a Company with no protectable period at all, or once its own binding
 * date has passed — at which point the ordinary pending-acceptance gate resumes with no code of its own
 * needed here (Section 20.2's own "the subscription does not continue on the new Terms" is the existing
 * Section 13 non-renewal machinery observing whatever Polar reports next, not a transition this module
 * drives).
 */
export function isWithinPaidPeriodGrace(
  sub: CompanySubscriptionPeriodFacts,
  publishedAt: Date,
  now: Date,
): boolean {
  const bindingDate = paidPeriodBindingDate(sub, publishedAt);
  return bindingDate !== null && now.getTime() < bindingDate.getTime();
}
