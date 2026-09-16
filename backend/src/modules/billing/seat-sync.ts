/**
 * One seat == one `UserCompany` row for a company (the OWNER counts from company creation; an
 * invitation counts only once ACCEPTED — never while merely pending, matching the product brief
 * exactly). Called as a plain, best-effort function from the FOUR places a `UserCompany` row actually
 * changes in this codebase — never through Nest DI, the same "framework-agnostic, called directly"
 * shape `mail/mail.service.ts#sendForCompany` or `documents/stock/apply-stock-on-issuance.ts` already
 * use — so wiring it in never requires touching a constructor (and risking every existing hand-built
 * `new XService(...)` spec for those files):
 *  - `company.service.ts` — a brand-new company's own OWNER row (createCompany);
 *  - `invitations.service.ts` — an EXISTING user accepting an invitation (acceptInvitation);
 *  - `lib/auth.ts` — a BRAND-NEW user signing up via an invitation code or their company's own SSO
 *    (`markInvitationAsUsed`/`attachSsoProvisionedMembership`), the one call site outside Nest DI
 *    entirely;
 *  - `companies.service.ts` — a member being removed (removeMember);
 *  - `auth-extended/account-lifecycle.ts` — a user deleting their OWN account
 *    (`cleanupAfterUserDelete`), once per company the DB's own `ON DELETE CASCADE` already removed
 *    their `UserCompany` row from.
 *
 * A no-op when billing is disabled (checked first, same as every other billing entry point) — so
 * these call sites cost a self-hosted instance nothing beyond one synchronous env read.
 *
 * NEVER throws into its caller: a Polar outage or a bad access token must not turn "accept an
 * invitation" or "remove a member" into a 500 — errors are logged and swallowed, the same
 * "never blocks the write it rides along with" discipline `applyStockOnIssuance`'s own header states
 * for stock effects. The NEXT membership change is one natural retry; `seat-reconcile.ts` is the
 * OTHER one — `billing-lifecycle-sweep-runner.ts` calls it every tick for every ACTIVE, subscribed
 * company, comparing this module's own `countCompanySeats` against what Polar's subscription actually
 * has on file and re-pushing the correction when a failed push here was never retried by a later
 * membership change (the "one person pays for a seat, then invites ten more, but the very last push
 * happened to fail" case).
 */
import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { getPolarClient } from './polar-client';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

export async function countCompanySeats(companyId: string): Promise<number> {
  return prisma.userCompany.count({ where: { companyId } });
}

export async function syncCompanySeatsOnMembershipChange(companyId: string): Promise<void> {
  if (!isBillingEnabled()) return;

  try {
    const [sub, seats] = await Promise.all([
      getOrCreateCompanySubscription(companyId),
      countCompanySeats(companyId),
    ]);

    if (sub.seats !== seats) {
      await prisma.companySubscription.update({ where: { companyId }, data: { seats } });
    }

    // Nothing to push to Polar yet — no checkout has ever completed for this company (see
    // `lifecycle.ts`'s own header on why `polarSubscriptionId` is exactly this signal).
    if (!sub.polarSubscriptionId) return;

    // `SubscriptionUpdateSeats` — the plain, quantity-only half of Polar's `PATCH
    // subscriptions/{id}` (`@polar-sh/sdk`'s `Subscriptions.update`), confirmed by reading
    // `node_modules/@polar-sh/sdk/dist/commonjs/models/components/subscriptionupdateseats.d.ts`
    // directly — NOT the full named-seat claim/assign/revoke subsystem Polar also exposes
    // (`customerSeats`/`customerPortalSeats`), which is a per-named-person invitation UX this task
    // does not build; this only keeps the BILLED COUNT in sync.
    await getPolarClient().subscriptions.update({
      id: sub.polarSubscriptionId,
      subscriptionUpdate: { seats },
    });
  } catch (error) {
    logger.warn('Polar seat sync failed — will retry on the next membership change', {
      category: 'billing',
      details: { companyId, error: error instanceof Error ? error.message : String(error) },
    });
  }
}
