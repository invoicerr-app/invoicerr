/**
 * API-level backstop for the "no free seat" gate, so a seatless member cannot write via an API key or a
 * client that ignores the frontend waiting screen.
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
      'This company has no free seat for you right now — ask the OWNER to free one, or buy ' +
      'more in the Polar portal. See Settings > Seats.',
    code: SEAT_REQUIRED_CODE,
  });
}
