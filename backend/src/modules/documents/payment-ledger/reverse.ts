import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { DocumentPaymentResult, recordPayment } from '../settlement/payments';

export interface ReversePaymentInput {
  reason: string;
  /** When the money went back; defaults to now. */
  paidAt?: Date;
}

/**
 * Cancels a recorded payment by recording its exact opposite: same document, currency and frozen
 * conversion, negated amounts, pointing at the original. The original stays as it was. A payment is
 * reversed at most once (a unique column guards the race), and a reversal is never itself reversed:
 * a payment reversed by mistake is entered again as a new payment.
 */
export async function reversePayment(
  companyId: string,
  paymentId: string,
  input: ReversePaymentInput,
): Promise<DocumentPaymentResult> {
  const reason = input.reason?.trim();
  if (!reason) throw new BadRequestException('A reason is required to reverse a payment.');

  const original = await prisma.documentPayment.findFirst({
    where: { id: paymentId, companyId },
    include: { reversedBy: { select: { id: true } } },
  });
  if (!original) throw new NotFoundException('Payment not found.');
  if (original.reversesPaymentId) {
    throw new BadRequestException('A reversing payment cannot itself be reversed.');
  }
  if (original.reversedBy) throw new ConflictException('This payment has already been reversed.');

  try {
    return await recordPayment({
      companyId,
      documentId: original.documentId,
      amountMinor: -original.amountMinor,
      currency: original.currency,
      documentAmountMinor: -original.documentAmountMinor,
      conversionRate: original.conversionRate ? Number(original.conversionRate.toString()) : null,
      conversionRateAsOf: original.conversionRateAsOf,
      conversionSource: original.conversionSource,
      method: original.method ?? undefined,
      paidAt: input.paidAt ?? new Date(),
      note: reason,
      reversesPaymentId: original.id,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new ConflictException('This payment has already been reversed.');
    }
    throw error;
  }
}
