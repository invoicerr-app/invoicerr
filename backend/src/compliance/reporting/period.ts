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
 * Monthly:   E_REPORTING, INTRASTAT, SALES_PURCHASE_LEDGER, CUSTOMS_EXPORT, SAFT, SII, VERIFACTU
 * Quarterly: OSS, IOSS, EC_SALES_LIST
 *
 * SII and VERIFACTU are both near-real-time / per-invoice obligations at AEAT (SII: within 4
 * working days of issuance; Verifactu: submission "as soon as" the invoice is issued/generated —
 * neither is periodic in the OSS/IOSS/ESL sense). They are bucketed MONTHLY here purely for the
 * idempotence periodKey (one ComplianceReport row's uniqueness window), mirroring how E_REPORTING
 * (also submitted per-transaction, not periodically) is bucketed.
 */
export function frequencyForKind(kind: ReportingKind): ReportFrequency {
  const QUARTERLY: ReportingKind[] = ['OSS', 'IOSS', 'EC_SALES_LIST'];
  return (QUARTERLY as string[]).includes(kind) ? 'QUARTERLY' : 'MONTHLY';
}
