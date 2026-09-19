/**
 * The real, cascading deletion `billing-lifecycle-sweep-runner.ts` runs once a `ZIPPED`
 * subscription's own grace period elapses (`lifecycle.ts`'s `delete_company` action) — the terminal
 * step of both cycles that file's own header describes.
 *
 * ## Cancel the Polar subscription FIRST
 *
 * A company being deleted must never keep being billed afterward — for a company that ever actually
 * paid (`polarSubscriptionId` set), the Polar subscription is REVOKED (immediate cancellation, never
 * merely "cancel at period end": there is no company left to serve out the rest of a period for) before
 * the Company row itself is touched. If that cancellation call fails, deletion is REFUSED outright —
 * `PolarCancellationFailedError` — rather than deleting the company anyway and leaving an orphaned,
 * still-active Polar subscription with no company left to associate it with. `billing-lifecycle-
 * sweep-runner.ts`'s own per-subscription try/catch already retries a thrown error on the next tick, so
 * this refusal is never a dead end, only a delay until the next attempt succeeds.
 *
 * Almost every relation onto `Company` in `schema.prisma` is `onDelete: Cascade` (verified directly:
 * of the 32 `<field> Company @relation(...)` lines in the schema, 31 carry it), so
 * `prisma.company.delete` alone already removes the company's clients, documents, invitations,
 * channel configs… and its own `CompanySubscription` row — which is exactly why `lifecycle.ts`'s own
 * header notes that no row is ever actually read back with `status: 'DELETED'`: the row disappears in
 * the same statement that would have written it.
 *
 * `Webhook.company` is the ONE exception (`model Webhook`, schema.prisma): its relation carries no
 * `onDelete` clause at all, so Postgres's default (`NO ACTION`) would make `company.delete` fail
 * outright with a foreign-key violation for any company that ever configured a webhook. Rather than
 * touch that unrelated model's own migration history for this feature, this function deletes that
 * ONE leftover table explicitly, in the same transaction, strictly BEFORE the company row itself —
 * literally "FK order" for the single case where the schema does not already give it for free.
 *
 * Deliberately does NOT touch `User` rows: a user can belong to other companies, and even one whose
 * last membership was this company is a login/identity the product brief never asked this feature to
 * remove — only the COMPANY and everything scoped to it.
 *
 * ## Never delete from a stale read
 *
 * This function's caller (`billing-lifecycle-sweep-runner.ts#applyOne`) decides `delete_company` from
 * a snapshot that can be an entire sweep pass old by the time this specific company's turn comes up —
 * a company that paid again in the meantime must never be deleted anyway. `isStillDueForDeletion` is
 * checked TWICE: once before the Polar revoke (skip the whole thing cheaply for the common case), and
 * again INSIDE the deletion transaction itself, immediately before `company.delete` — the revoke is a
 * real network call, so the row can legitimately move on during it. Returns whether it actually
 * deleted, rather than assuming success, so the caller's own `deleted` counter stays honest.
 */
import prisma from '@/prisma/prisma.service';

import { CompanySubscriptionStatus } from '../../../prisma/generated/prisma/client';
import { getPolarClient } from './polar-client';

export const POLAR_CANCELLATION_FAILED_CODE = 'POLAR_CANCELLATION_FAILED';

/** Thrown — and deletion refused — when a paying company's Polar subscription cannot be canceled.
 *  Named so a caller (or a future manual "delete this company" route reusing this same function) can
 *  branch on it without string-matching, the same convention `BillingEmailTakenError` already holds. */
export class PolarCancellationFailedError extends Error {
  readonly code = POLAR_CANCELLATION_FAILED_CODE;

  constructor(
    readonly companyId: string,
    readonly cause: unknown,
  ) {
    super(
      `Could not cancel company ${companyId}'s Polar subscription — refusing to delete the company. ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = 'PolarCancellationFailedError';
  }
}

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to. `Subscriptions.revoke` — "Revoke a subscription, i.e
 *  cancel immediately" — confirmed by reading `@polar-sh/sdk`'s own
 *  `node_modules/@polar-sh/sdk/dist/commonjs/sdk/subscriptions.d.ts` directly. */
export interface DeletionPolarClient {
  subscriptions: {
    revoke(request: { id: string }): Promise<unknown>;
  };
}

/** `true` only when the row, as just read, is STILL actually due for deletion — `null`/`undefined`
 *  covers both "no such row" (should not happen once a company reaches ZIPPED) and "the row already
 *  vanished". Shared by the pre-revoke check and the in-transaction re-check below so the two can
 *  never silently drift apart on what "due" means. */
function isStillDueForDeletion(
  sub: { status: CompanySubscriptionStatus; deletionDueAt: Date | null } | null | undefined,
  now: Date,
): boolean {
  return (
    !!sub &&
    sub.status === 'ZIPPED' &&
    sub.deletionDueAt !== null &&
    sub.deletionDueAt.getTime() <= now.getTime()
  );
}

/**
 * `now` defaults to the real clock but is always passed explicitly by this function's one real
 * caller (`billing-lifecycle-sweep-runner.ts`) — the SAME `now` its own sweep tick started from, so
 * the guard below re-checks against the exact instant that tick's `computeLifecycleTransition` call
 * already decided this company was due, never a slightly later clock read that could itself disagree.
 *
 * Returns whether the company was actually deleted — `false` when the guard below found the row no
 * longer eligible (see this function's own header on why a stale read must never drive an
 * irreversible delete), so the caller can count/log accurately instead of assuming success.
 */
export async function deleteCompanyPermanently(
  companyId: string,
  now: Date = new Date(),
  client: DeletionPolarClient = getPolarClient() as unknown as DeletionPolarClient,
): Promise<boolean> {
  const sub = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { polarSubscriptionId: true, status: true, deletionDueAt: true },
  });

  // A webhook can flip this company back to a live, paying state at ANY point between the sweep
  // reading its own snapshot (possibly a full pass — thousands of rows — ago) and this function
  // actually running: DELETION IS IRREVERSIBLE, so a stale decision is refused outright rather than
  // trusted, the same discipline the CAS writes in `billing-lifecycle-sweep-runner.ts#applyOne` hold
  // for their own (recoverable) transitions.
  if (!isStillDueForDeletion(sub, now)) return false;

  // `polarSubscriptionId` is set exactly once, the moment a checkout completes, and NEVER cleared
  // afterward (`lifecycle.ts`'s own header) — so its presence here means "this company once had a
  // REAL Polar subscription", regardless of whatever status it currently reads as. A never-paid
  // company (never checked out) has nothing to cancel at all.
  if (sub?.polarSubscriptionId) {
    try {
      await client.subscriptions.revoke({ id: sub.polarSubscriptionId });
    } catch (error) {
      throw new PolarCancellationFailedError(companyId, error);
    }
  }

  return prisma.$transaction(async (tx) => {
    // Re-read INSIDE the same transaction as the delete itself, right before it: the Polar revoke
    // above is a real network round-trip, exactly the kind of window a webhook can land in between
    // the check above and this point. A row that moved on in that window must abort here — the DB
    // delete never runs — rather than trusting a read that is, by construction, at least one await
    // old by the time it gets here.
    const fresh = await tx.companySubscription.findUnique({
      where: { companyId },
      select: { status: true, deletionDueAt: true },
    });
    if (!isStillDueForDeletion(fresh, now)) return false;

    await tx.webhook.deleteMany({ where: { companyId } });
    await tx.company.delete({ where: { id: companyId } });
    return true;
  });
}

/**
 * Manual, OWNER-INITIATED deletion — "Delete company" in the danger zone (`danger/danger.service.ts`).
 * Unlike `deleteCompanyPermanently` above, this is never driven by `CompanySubscription.status`/
 * `deletionDueAt`: an OWNER who cleared the OTP challenge AND retyped the company's own exact name
 * already IS the "due" signal there is to have — gating this on `status === 'ZIPPED'` the same way
 * would make a company that never entered the billing lifecycle at all (self-hosted, no
 * `CompanySubscription` row, or a paying company that has simply never missed a payment) unable to
 * ever delete itself. The two non-negotiable disciplines `deleteCompanyPermanently` enforces stay
 * exactly as strict here: a PAID company's Polar subscription is revoked FIRST, and the whole
 * deletion is refused if that call fails (`PolarCancellationFailedError`) — never a company deleted
 * while still actively billed; `Webhook` is deleted explicitly before `Company` (see this file's own
 * header on why that one relation alone needs it).
 */
export async function deleteCompanyPermanentlyNow(
  companyId: string,
  client: DeletionPolarClient = getPolarClient() as unknown as DeletionPolarClient,
): Promise<void> {
  const sub = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { polarSubscriptionId: true },
  });

  if (sub?.polarSubscriptionId) {
    try {
      await client.subscriptions.revoke({ id: sub.polarSubscriptionId });
    } catch (error) {
      throw new PolarCancellationFailedError(companyId, error);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.webhook.deleteMany({ where: { companyId } });
    await tx.company.delete({ where: { id: companyId } });
  });
}
