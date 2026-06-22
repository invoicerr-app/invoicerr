import { CountryComplianceProfile } from '../schema';

/**
 * Monaco — within the French VAT territory. Demonstrates profile *delegation*: MC resolves to the
 * FR profile transparently (COMPLIANCE_ARCHITECTURE.md §15 "special cases"). The lists below are
 * never consulted once `delegatesTo` is followed; they exist only to satisfy the type.
 */
export const MC: CountryComplianceProfile = {
  countryCode: 'MC',
  displayName: 'Monaco',
  schemaVersion: '1.0',
  delegatesTo: 'FR',
  confidence: 'OFFICIAL',
  regime: [],
  formats: [],
  transmission: [],
  taxSystem: { kind: 'VAT', standardRate: 20 },
  lifecycle: [],
  archival: [],
  reporting: [],
  numbering: [],
};
