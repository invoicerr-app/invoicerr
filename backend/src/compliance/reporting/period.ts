/**
 * Period key computation for periodic compliance reporting.
 * All dates are treated as UTC to avoid timezone drift in period boundaries.
 */
import { ReportingKind } from '../types';

export type ReportFrequency = 'MONTHLY' | 'QUARTERLY';

/**
 * Returns the ISO period key for a given date and frequency.
 * Monthly  → "2026-06"
 * Quarterly → "2026-Q2"
 */
export function getPeriodKey(date: Date, frequency: ReportFrequency): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1–12
  if (frequency === 'MONTHLY') {
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}

/**
 * Default filing frequency per reporting kind (per OECD / EU / national rules).
 * Monthly:   E_REPORTING, INTRASTAT, SALES_PURCHASE_LEDGER, CUSTOMS_EXPORT, SAFT
 * Quarterly: OSS, IOSS, EC_SALES_LIST
 */
export function frequencyForKind(kind: ReportingKind): ReportFrequency {
  const QUARTERLY: ReportingKind[] = ['OSS', 'IOSS', 'EC_SALES_LIST'];
  return (QUARTERLY as string[]).includes(kind) ? 'QUARTERLY' : 'MONTHLY';
}
