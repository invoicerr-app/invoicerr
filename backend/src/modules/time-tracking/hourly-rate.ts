import { fromMinor, toMinor } from '@/utils/financial';

/*
 * Every rate this module stores (Project's default hourly rate, a TimeEntry's own override) is
 * converted between the MAJOR units a user types (e.g. "75.00") and the minor-unit integer actually
 * persisted (`hourlyRateMinor`, same convention as `Article.unitPriceMinor`), in the company's own
 * currency (`company/resolve-company-currency.ts`). Shared by ProjectsService and TimeEntriesService
 * rather than copied into each; the invoice this feature generates (generate-invoice-lines.ts) prices
 * every line in that same currency too.
 */

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
