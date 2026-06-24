import { CountryComplianceProfile } from '../schema';
import { clearance, noMandate, peppolCtc, periodic, planned, postAudit, realTime, vat } from '../archetypes';

/**
 * Europe (EU + EEA + Balkans + microstates), excluding the bespoke FR/IT/PL/MC profiles.
 * Rates and dates are BEST_EFFORT data to be refined against documentation/compliance over time.
 */
export const EUROPE_PROFILES: CountryComplianceProfile[] = [
  // --- Majors (not in documentation/compliance but traded with heavily) ---
  postAudit('DE', 'Germany', { tax: vat(19, [7]), primary: 'XRECHNUNG', receiveSyntax: 'XRECHNUNG' }),
  realTime('ES', 'Spain', { from: '2017-07-01', syntax: 'ES_FACTURAE', providerId: 'es-aeat', tax: vat(21, [10, 4]), channel: 'GOV_PORTAL_API' }), // Facturae + SII/Verifactu
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
  realTime('LV', 'Latvia', { from: '2026-01-01', syntax: 'EN16931_UBL', providerId: 'lv-vid', tax: vat(21, [12, 5]) }),
  postAudit('MT', 'Malta', { tax: vat(18, [7, 5]) }),
  realTime('SK', 'Slovakia', { from: '2027-01-01', syntax: 'EN16931_UBL', providerId: 'sk-financnasprava', tax: vat(23, [19, 5]) }),
  peppolCtc('SI', 'Slovenia', { ctcFrom: '2027-06-01', tax: vat(22, [9.5, 5]) }),
  clearance('HR', 'Croatia', { from: '2026-01-01', syntax: 'HR_ERACUN', providerId: 'hr-fiskalizacija', tax: vat(25, [13, 5]) }), // Fiscalization 2.0 / e-Račun

  // --- EEA / EFTA / Balkans / accession ---
  clearance('AL', 'Albania', { from: '2021-01-01', syntax: 'AL_FISCALIZATION', providerId: 'al-cis', tax: vat(20) }), // CIS fiscalization
  planned('BA', 'Bosnia and Herzegovina', { tax: vat(17) }),
  realTime('ME', 'Montenegro', { from: '2021-01-01', syntax: 'ME_FISCAL', providerId: 'me-fiscal', tax: vat(21, [7]) }),
  planned('MK', 'North Macedonia', { tax: vat(18, [5]) }),
  postAudit('MD', 'Moldova', { tax: vat(20, [8]) }),
  clearance('UA', 'Ukraine', { syntax: 'UA_TAXINVOICE', providerId: 'ua-dps', tax: vat(20, [7]) }), // VAT invoice registration (ЄРПН) blocks
  postAudit('LI', 'Liechtenstein', { tax: vat(8.1, [3.8, 2.6]) }), // Swiss VAT system

  // --- Microstates with special channels ---
  clearance('SM', 'San Marino', { syntax: 'FATTURAPA', channel: 'SDI', tax: vat(0), signed: false }), // monofase via SdI
  noMandate('VA', 'Vatican City', { tax: vat(0) }),

  // --- Majors/EEA added with the dev docs merge (78→106 country specs) ---
  postAudit('AT', 'Austria', { tax: vat(20, [13, 10]) }), // B2G mandatory, B2B voluntary
  peppolCtc('BE', 'Belgium', { ctcFrom: '2026-01-01', tax: vat(21, [12, 6]) }), // B2B mandate Jan 2026 (Peppol)
  postAudit('NL', 'Netherlands', { tax: vat(21, [9]) }), // Peppol, voluntary B2B
  postAudit('SE', 'Sweden', { tax: vat(25, [12, 6]) }), // Peppol/SFTI, B2G mandatory
  postAudit('NO', 'Norway', { tax: vat(25, [15, 12]) }), // EEA; EHF/Peppol + SAF-T
  noMandate('CH', 'Switzerland', { tax: vat(8.1, [3.8, 2.6]) }), // no e-invoicing mandate (QR-bill domestic)
  periodic('PT', 'Portugal', { tax: vat(23, [13, 6]) }), // SAF-T PT + ATCUD/QR ("smart invoice")
  realTime('GR', 'Greece', { from: '2021-01-01', tax: vat(24, [13, 6]) }), // myDATA
  realTime('HU', 'Hungary', { from: '2018-07-01', tax: vat(27, [18, 5]) }), // Online Számla (RTIR)
  clearance('RO', 'Romania', { from: '2024-01-01', syntax: 'EN16931_UBL', providerId: 'anaf', tax: vat(19, [9, 5]) }), // RO e-Factura (UBL/RO_CIUS, SPV)
  clearance('RS', 'Serbia', { syntax: 'EN16931_UBL', providerId: 'rs-sef', tax: vat(20, [10]) }), // SEF (UBL/SRBEFN)
];
