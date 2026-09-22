/**
 * `LegalAcceptanceGuard`'s own Terms of Service Section 20.2 exception: given the slugs a caller has
 * NOT yet accepted (`getPendingAcceptanceSlugs`), returns the subset that STILL blocks the write —
 * i.e. `pending` minus `'terms-of-service'` when this Company has a subscription period already in
 * progress that Section 20.2 protects (`modules/billing/paid-period-grace.ts`).
 *
 * Deliberately narrow to exactly that one slug — "do not extend this reasoning to documents it does not
 * concern": the paid-period principle is about the CONTRACT the Customer bought a period of Service
 * under, which is what `terms-of-service` is. `privacy-policy` (the only other member of
 * `REQUIRED_ACCEPTANCE_SLUGS`) is not something a period is "bought under" in that sense, so a pending
 * Privacy Policy re-acceptance always blocks immediately, exactly as it did before this exception
 * existed, whether or not a paid period is running.
 *
 * Every early return below is a "no exception, block as before" answer, by design — this function only
 * ever REMOVES `'terms-of-service'` from what it was given, never adds anything back, so any case this
 * has no data for (no active company on the request, no subscription row yet, no recorded release
 * timestamp yet) fails toward the pre-existing, safe behavior rather than toward granting access.
 */
import { findCompanySubscription } from '@/modules/billing/company-subscription.store';
import { isWithinPaidPeriodGrace } from '@/modules/billing/paid-period-grace';

import { currentReleasePublishedAt } from './legal-release-lookup';

/** The one slug Section 20.2 ever excuses — see this file's own header. */
const TERMS_OF_SERVICE_SLUG = 'terms-of-service';

export async function filterPendingSlugsAfterPaidPeriodGrace(
  pending: readonly string[],
  companyId: string | null,
  now: Date = new Date(),
): Promise<string[]> {
  if (!pending.includes(TERMS_OF_SERVICE_SLUG)) return [...pending];
  // No active company on this request (pre-onboarding, a session-level route) — nothing to check a
  // subscription period against, so nothing to protect.
  if (!companyId) return [...pending];

  const sub = await findCompanySubscription(companyId);
  // No row at all reads the same as a fresh TRIAL row would: no subscription period has ever been paid
  // for yet, so there is nothing for Section 20.2 to protect (`findCompanySubscription`'s own header).
  if (!sub) return [...pending];

  const publishedAt = await currentReleasePublishedAt(TERMS_OF_SERVICE_SLUG);
  // Defensive: unreachable in steady state (`legal-release-boot.service.ts` records this at every
  // boot before any request is served) — without a real publish timestamp there is no calendar floor
  // to compute, so this falls back to the pre-existing immediate-effect behavior rather than guessing.
  if (!publishedAt) return [...pending];

  if (!isWithinPaidPeriodGrace(sub, publishedAt, now)) return [...pending];

  return pending.filter((slug) => slug !== TERMS_OF_SERVICE_SLUG);
}
