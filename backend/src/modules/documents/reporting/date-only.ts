/**
 * Whether a value is a plain `YYYY-MM-DD` calendar day that exists (no 2026-02-30). The one test
 * the obligation loader (`obligation-v2.ts`) and the due-date arithmetic (`periods.ts`) share. A leaf
 * module on purpose: `periods.ts` already imports `obligation-v2.ts`, so neither can import the other.
 */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
