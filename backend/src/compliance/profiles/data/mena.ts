import { CountryComplianceProfile } from '../schema';
import { clearance, peppolCtc, planned, vat, noTax } from '../archetypes';

/** Middle East & North Africa. GCC VAT where implemented; several mandates still planned. */
export const MENA_PROFILES: CountryComplianceProfile[] = [
  peppolCtc('AE', 'United Arab Emirates', { ctcFrom: '2026-07-01', tax: vat(5) }), // 5-corner accredited SPs
  clearance('SA', 'Saudi Arabia', { from: '2023-01-01', syntax: 'KSA_UBL', residency: 'SA', retentionYears: 6, tax: vat(15) }), // ZATCA FATOORA
  clearance('JO', 'Jordan', { tax: vat(16) }), // JoFotara
  clearance('TN', 'Tunisia', { tax: vat(19, [13, 7]) }), // El Fatoura / TEIF via TTN
  planned('BH', 'Bahrain', { tax: vat(10) }),
  planned('OM', 'Oman', { tax: vat(5) }),
  planned('QA', 'Qatar', { tax: noTax() }), // no VAT yet
  planned('KW', 'Kuwait', { tax: noTax() }), // no VAT yet
  planned('DZ', 'Algeria', { tax: vat(19, [9]) }),
  planned('MA', 'Morocco', { tax: vat(20, [14, 10, 7]) }),
];
