/**
 * Romania (RO) — Europe.
 * RO e-Factura (UBL/RO_CIUS, SPV)
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const RO: CountryComplianceProfile = clearance('RO', 'Romania', {
  from: '2024-01-01',
  syntax: 'EN16931_UBL',
  providerId: 'anaf',
  tax: vat(19, [9, 5]),
});
