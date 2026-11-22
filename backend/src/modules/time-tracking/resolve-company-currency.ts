import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { fromMinor, toMinor } from '@/utils/financial';

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

/** A rate as typed (MAJOR units) to its stored minor-unit integer. Both `null` and an omitted rate
 *  store `null`: what a create wants, where there is no current value to keep. */
export function rateToMinor(rate: number | null | undefined, currency: string): number | null {
  return rate != null ? toMinor(rate, currency) : null;
}

/** The stored rate after a PATCH. `!== undefined` (never `??`): an explicit `null` clears the rate,
 *  an omitted field keeps `currentMinor`. */
export function patchRateMinor(
  rate: number | null | undefined,
  currentMinor: number | null,
  currency: string,
): number | null {
  return rate !== undefined ? rateToMinor(rate, currency) : currentMinor;
}

/** A stored minor-unit rate back to the MAJOR units every caller is handed; `null` stays `null`. */
export function minorToRate(minor: number | null, currency: string): number | null {
  return minor !== null ? fromMinor(minor, currency) : null;
}
