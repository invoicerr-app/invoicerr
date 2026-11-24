import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

/**
 * The company's own currency, the one every minor-unit amount it stores is denominated in: an
 * article's `unitPriceMinor` (articles.service.ts), a project's or time entry's `hourlyRateMinor` and
 * the invoice lines time tracking generates from them (time-tracking/hourly-rate.ts). One read and one
 * 404 for all of them, rather than a private copy per module. `documents.service.ts` reads the same
 * column on its own on purpose: it falls back to EUR instead of answering 404.
 */
export async function resolveCompanyCurrency(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { currency: true } });
  if (!company) {
    throw new NotFoundException('Company not found');
  }
  return company.currency;
}
