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
 */
import prisma from '@/prisma/prisma.service';

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

export async function deleteCompanyPermanently(
  companyId: string,
  client: DeletionPolarClient = getPolarClient() as unknown as DeletionPolarClient,
): Promise<void> {
  const sub = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { polarSubscriptionId: true },
  });

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

  await prisma.$transaction([
    prisma.webhook.deleteMany({ where: { companyId } }),
    prisma.company.delete({ where: { id: companyId } }),
  ]);
}
