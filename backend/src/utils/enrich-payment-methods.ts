import type { PaymentMethod } from '../../prisma/generated/prisma/client';

import prisma from '@/prisma/prisma.service';

type HasPaymentMethod = {
  paymentMethodId?: string | null;
  paymentMethod?: PaymentMethod | string | null;
};

/**
 * Attach the full PaymentMethod record (when `paymentMethodId` is set) so the
 * frontend can consume `row.paymentMethod` as an object instead of the legacy
 * string. Rows without a resolvable payment method are returned unchanged.
 */
export async function enrichWithPaymentMethod<T extends HasPaymentMethod>(row: T): Promise<T> {
  if (!row.paymentMethodId) return row;
  const pm = await prisma.paymentMethod.findUnique({ where: { id: row.paymentMethodId } });
  if (!pm) return row;
  return { ...row, paymentMethod: pm };
}

/** List variant of {@link enrichWithPaymentMethod}. */
export function enrichWithPaymentMethods<T extends HasPaymentMethod>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map((row) => enrichWithPaymentMethod(row)));
}
