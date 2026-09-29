/**
 * One checksum-valid identifier set per supported country, in the shape `country-identifiers/data/
 * <cc>.json` actually declares for that country (`modules/documents/country-identifiers/`):
 *  - FR: `LEGAL_ID` (SIRET, required) + `VAT` (intra-EU VAT, derived from the same SIREN).
 *  - DE: `VAT` (USt-IdNr) only.
 *  - IT: `VAT` (Partita IVA, BARE 11 digits — no "IT" prefix, matching how this codebase's own
 *    `validateItVat`/`vat-syntax.ts` dispatcher reads it and how `e2e/cypress/fixtures/scenarios.ts`
 *    stores Italian legal ids).
 *  - PL: `LEGAL_ID` (NIP, BARE 10 digits — the NIP itself carries no country prefix; the "PL" prefix
 *    only ever appears on the derived VAT-number FORM, which this catalog does not separately declare
 *    for Poland).
 *  - PT: `LEGAL_ID` (NIF/NIPC, required) + `VAT` ("PT" + the same NIF digits).
 */
import {
  generateDeVat,
  generateFrIdentifiers,
  generateItPartitaIva,
  generatePlNip,
  generatePtNif,
} from './identifiers';
import { SupportedCountryCode } from './data-pools';
import { Rng } from './rng';

export interface PartyIdentifierEntry {
  scheme: 'LEGAL_ID' | 'VAT';
  value: string;
}

export function generatePartyIdentifiers(
  rng: Rng,
  countryCode: SupportedCountryCode,
): PartyIdentifierEntry[] {
  switch (countryCode) {
    case 'FR': {
      const { siret, vat } = generateFrIdentifiers(rng);
      return [
        { scheme: 'LEGAL_ID', value: siret },
        { scheme: 'VAT', value: vat },
      ];
    }
    case 'DE':
      return [{ scheme: 'VAT', value: generateDeVat(rng) }];
    case 'IT':
      return [{ scheme: 'VAT', value: generateItPartitaIva(rng) }];
    case 'PL':
      return [{ scheme: 'LEGAL_ID', value: generatePlNip(rng) }];
    case 'PT': {
      const nif = generatePtNif(rng);
      return [
        { scheme: 'LEGAL_ID', value: nif },
        { scheme: 'VAT', value: `PT${nif}` },
      ];
    }
  }
}

/** The value a document line's `vatRate` (a 'select' field, `usesVatRateCatalog: true`) must carry to
 *  resolve to this country's own STANDARD rate — every shipped `vat-rates/data/<cc>.json` names its
 *  standard-category rate `"<cc>-standard"` (lowercase), confirmed by reading all five files directly
 *  before this was written. */
export function standardVatRateId(countryCode: SupportedCountryCode): string {
  return `${countryCode.toLowerCase()}-standard`;
}
