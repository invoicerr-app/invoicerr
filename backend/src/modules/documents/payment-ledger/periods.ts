/** UTC calendar periods a closure covers. */

export const CLOSURE_KINDS = ['DAILY', 'MONTHLY', 'YEARLY'] as const;
export type ClosureKind = (typeof CLOSURE_KINDS)[number];

export function periodStart(kind: ClosureKind, at: Date): Date {
  const year = at.getUTCFullYear();
  if (kind === 'YEARLY') return new Date(Date.UTC(year, 0, 1));
  if (kind === 'MONTHLY') return new Date(Date.UTC(year, at.getUTCMonth(), 1));
  return new Date(Date.UTC(year, at.getUTCMonth(), at.getUTCDate()));
}

export function nextPeriodStart(kind: ClosureKind, start: Date): Date {
  const year = start.getUTCFullYear();
  if (kind === 'YEARLY') return new Date(Date.UTC(year + 1, 0, 1));
  if (kind === 'MONTHLY') return new Date(Date.UTC(year, start.getUTCMonth() + 1, 1));
  return new Date(Date.UTC(year, start.getUTCMonth(), start.getUTCDate() + 1));
}

export function addTotals(base: Record<string, number>, add: Record<string, number>): Record<string, number> {
  const result = { ...base };
  for (const [currency, minor] of Object.entries(add)) result[currency] = (result[currency] ?? 0) + minor;
  return result;
}
