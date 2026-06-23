import { CountryComplianceProfile } from '../schema';
import { clearance, noMandate, peppolCtc, planned, postAudit, realTime, vat } from '../archetypes';

/**
 * Europe (EU + EEA + Balkans + microstates), excluding the bespoke FR/IT/PL/MC profiles.
 * Rates and dates are BEST_EFFORT data to be refined against docs/compliance over time.
 */
export const EUROPE_PROFILES: CountryComplianceProfile[] = [
  // --- Majors (not in docs/compliance but traded with heavily) ---
  postAudit('DE', 'Germany', { tax: vat(19, [7]), primary: 'XRECHNUNG', receiveSyntax: 'XRECHNUNG' }),
  realTime('ES', 'Spain', { from: '2017-07-01', tax: vat(21, [10, 4]), channel: 'GOV_PORTAL_API' }),
  noMandate('GB', 'United Kingdom', { tax: vat(20, [5]) }),

  // --- EU member states (post-audit today; several phasing into CTC/RTR) ---
  peppolCtc('IE', 'Ireland', { ctcFrom: '2028-11-01', tax: vat(23, [13.5, 9, 4.8]) }),
  postAudit('BG', 'Bulgaria', { tax: vat(20, [9]) }),
  postAudit('CY', 'Cyprus', { tax: vat(19, [9, 5]) }),
  postAudit('CZ', 'Czechia', { tax: vat(21, [12]) }),
  postAudit('DK', 'Denmark', { tax: vat(25) }),
  postAudit('EE', 'Estonia', { tax: vat(22) }),
  postAudit('FI', 'Finland', { tax: vat(25.5, [14, 10]) }),
  postAudit('LT', 'Lithuania', { tax: vat(21, [9, 5]) }),
  postAudit('LU', 'Luxembourg', { tax: vat(17, [14, 8, 3]) }),
  realTime('LV', 'Latvia', { from: '2026-01-01', tax: vat(21, [12, 5]) }),
  postAudit('MT', 'Malta', { tax: vat(18, [7, 5]) }),
  realTime('SK', 'Slovakia', { from: '2027-01-01', tax: vat(23, [19, 5]) }),
  peppolCtc('SI', 'Slovenia', { ctcFrom: '2027-06-01', tax: vat(22, [9.5, 5]) }),
  clearance('HR', 'Croatia', { from: '2026-01-01', tax: vat(25, [13, 5]) }),

  // --- EEA / EFTA / Balkans / accession ---
  clearance('AL', 'Albania', { from: '2021-01-01', tax: vat(20) }),
  planned('BA', 'Bosnia and Herzegovina', { tax: vat(17) }),
  realTime('ME', 'Montenegro', { from: '2021-01-01', tax: vat(21, [7]) }),
  planned('MK', 'North Macedonia', { tax: vat(18, [5]) }),
  postAudit('MD', 'Moldova', { tax: vat(20, [8]) }),
  clearance('UA', 'Ukraine', { tax: vat(20, [7]) }), // VAT invoice registration (ЄРПН) blocks
  postAudit('LI', 'Liechtenstein', { tax: vat(8.1, [3.8, 2.6]) }), // Swiss VAT system

  // --- Microstates with special channels ---
  clearance('SM', 'San Marino', { syntax: 'FATTURAPA', channel: 'SDI', tax: vat(0), signed: false }), // monofase via SdI
  noMandate('VA', 'Vatican City', { tax: vat(0) }),
];
