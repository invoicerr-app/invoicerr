/**
 * Overwrites the local seat count with Polar's, as a retry for a missed `subscription.*` webhook.
 * Invoicerr only ever reads seat quantity from Polar; never call `subscriptions.update` here
 * (`no-seat-quantity-write.spec.ts` guards this).
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { getPolarClient } from './polar-client';

export interface SeatReconcileClient {
  subscriptions: {
    get(id: string): Promise<{ seats?: number | null }>;
  };
}

export interface SeatReconcileResult {
  corrected: boolean;
  localSeats: number;
  polarSeats: number | null;
}

/** A missing `seats` in Polar's response is left uncorrected rather than overwriting a real value. */
export async function reconcileCompanySeats(
  sub: Pick<CompanySubscription, 'companyId' | 'polarSubscriptionId' | 'seats'>,
  client: SeatReconcileClient = getPolarClient() as unknown as SeatReconcileClient,
): Promise<SeatReconcileResult | null> {
  if (!sub.polarSubscriptionId) return null;

  const polarSubscription = await client.subscriptions.get(sub.polarSubscriptionId);
  const polarSeats = polarSubscription.seats ?? null;

  if (polarSeats === null || polarSeats === sub.seats) {
    return { corrected: false, localSeats: sub.seats, polarSeats };
  }

  await prisma.companySubscription.update({
    where: { companyId: sub.companyId },
    data: { seats: polarSeats },
  });

  logger.warn('Seat quantity drift corrected FROM Polar (local row was stale)', {
    category: 'billing',
    companyId: sub.companyId,
    details: { companyId: sub.companyId, previousLocalSeats: sub.seats, polarSeats },
  });

  return { corrected: true, localSeats: polarSeats, polarSeats };
}
