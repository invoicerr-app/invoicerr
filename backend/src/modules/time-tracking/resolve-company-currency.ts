import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

/**
 * The company's own currency — used to convert every rate this module stores (Project's default
 * hourly rate, a TimeEntry's own override) between the MAJOR units a user types (e.g. "75.00") and
 * the minor-unit integer actually persisted (`hourlyRateMinor`, same convention as
 * `Article.unitPriceMinor`). Shared by ProjectsService and TimeEntriesService rather than copied
 * into each (the single-caller precedent is articles.service.ts's own private `getCompanyCurrency`)
 * because a THIRD caller needs the exact same fact for the exact same reason: the invoice this
 * feature generates (generate-invoice-lines.ts) prices every line in this same currency too.
 */
export async function resolveCompanyCurrency(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { currency: true } });
  if (!company) {
    throw new NotFoundException('Company not found');
  }
  return company.currency;
}
