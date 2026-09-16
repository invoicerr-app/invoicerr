/**
 * The write-side half of the "no free seat" gate — the read side is the frontend's own waiting screen
 * (`(app)/_layout.tsx`), driven by `GET /api/billing/seats`. This is the API-level backstop: a member
 * who has lost their seat (an over-capacity company, `seat-holders.ts#seatHolders`) must not be able to
 * write through the API even if they never load the waiting screen — an API key, a stale tab, or a
 * client that ignores the frontend gate.
 *
 * Wired into `company-write.guard.ts` right alongside `write-gate.ts#assertCompanyWritable` — same
 * exemptions (GET/HEAD/OPTIONS, no active company, `@BillingGateExempt()`), same "a no-op when billing
 * is disabled" first check.
 */
import { ForbiddenException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { memberHoldsSeat } from './seat-holders';

export const SEAT_REQUIRED_CODE = 'SEAT_REQUIRED';

/**
 * Throws (403, `{ message, code: SEAT_REQUIRED }`) when `userId` is currently WAITING for a seat in
 * `companyId` — resolves silently otherwise, including for a user with no membership row in this
 * company at all (nothing this gate is meant to catch; a route reaching this far already has an active
 * company on the request, which normally implies membership).
 */
export async function assertUserHasSeatOrThrow(companyId: string, userId: string): Promise<void> {
  if (!isBillingEnabled()) return;

  const sub = await getOrCreateCompanySubscription(companyId);
  const members = await prisma.userCompany.findMany({
    where: { companyId },
    select: { userId: true, role: true, createdAt: true },
  });

  if (memberHoldsSeat(members, sub.seats, userId)) return;

  throw new ForbiddenException({
    message:
      'This company has no free seat for you right now — ask the OWNER to free one, or buy ' +
      'more in the Polar portal. See Settings > Seats.',
    code: SEAT_REQUIRED_CODE,
  });
}
