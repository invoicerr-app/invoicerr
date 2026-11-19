/**
 * The API side of the "not enough seats" gate; the frontend side is the full-screen
 * `not-enough-seats-screen.tsx` (`(app)/_layout.tsx`), shown when `GET /api/billing/seats` itself
 * answers `SEAT_REQUIRED`. A member who has lost their seat (an over-capacity company,
 * `seat-holders.ts#seatHolders`: the most recently arrived members go first) can do NOTHING on that
 * company through the API, not even read (product decision 2026-11-13): an API key, a stale tab, or a
 * client that ignores the frontend gate gets the same refusal.
 *
 * Wired into `company-write.guard.ts` for every method, alongside the write-only
 * `write-gate.ts#assertCompanyWritable`. Exempt: no active company on the request, a route marked
 * `@SeatGateExempt()`, and everything while billing is disabled.
 */
import { ForbiddenException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { memberHoldsSeat } from './seat-holders';

export const SEAT_REQUIRED_CODE = 'SEAT_REQUIRED';

/**
 * Throws 403 `SEAT_REQUIRED` when `userId` is waiting for a seat. A caller with no membership row at all
 * (e.g. a removal racing this request) is let through rather than refused with the wrong reason.
 */
export async function assertUserHasSeatOrThrow(companyId: string, userId: string): Promise<void> {
  if (!isBillingEnabled()) return;

  const sub = await getOrCreateCompanySubscription(companyId);
  const members = await prisma.userCompany.findMany({
    where: { companyId },
    select: { userId: true, role: true, createdAt: true },
  });

  if (!members.some((member) => member.userId === userId)) return;
  if (memberHoldsSeat(members, sub.seats, userId)) return;

  throw new ForbiddenException({
    message:
      'Your company does not have enough seats for you right now. Ask an owner or admin to buy ' +
      'more seats in the billing settings, or to free one.',
    code: SEAT_REQUIRED_CODE,
  });
}
