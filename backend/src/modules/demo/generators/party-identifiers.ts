/**
 * One checksum-valid identifier set per supported country, in the shape `country-identifiers/data/
 * <cc>.json` actually declares for that country (`modules/documents/country-identifiers/`):
 *  - FR: `LEGAL_ID` (SIRET, required) + `VAT` (intra-EU VAT, derived from the same SIREN).
 *  - DE: `VAT` (USt-IdNr) only.
 *  - IT: `VAT` (Partita IVA, BARE 11 digits, no "IT" prefix, matching how this codebase's own
 *    `validateItVat`/`vat-syntax.ts` dispatcher reads it and how `e2e/cypress/fixtures/scenarios.ts`
 *    stores Italian legal ids).
 *  - PL: `LEGAL_ID` (NIP, BARE 10 digits: the NIP itself carries no country prefix; the "PL" prefix
 *    only ever appears on the derived VAT-number FORM, which this catalog does not separately declare
 *    for Poland).
 *  - PT: `LEGAL_ID` (NIF/NIPC, required) + `VAT` ("PT" + the same NIF digits).
 *  - DZ: `RC`, `NIS`, `NIF`, `AI` (all four, `country-identifiers/data/dz.json`'s own four schemes,
 *    every one `required: true`). RC and AI declare no `pattern` (free text per PR #566's review,
 *    native contributor, 2026-09-30); NIF and NIS each now declare one (digits only, 15 or 20 for
 *    NIF, 15 or 18 for NIS, same source), enforced by `validate-identifier-value.ts`. No check-digit
 *    algorithm for any of the four turned up in issue #558's own research though - unlike FR/DE/IT/PL's
 *    real checksums or even PT's homegrown one (`identifiers.ts`'s own header), there is nothing to
 *    compute here. The four values below are plausible, fixed-shape demo strings that also satisfy the
 *    declared patterns - not a legal claim, same discipline `data-pools.ts`'s own DZ entry states for
 *    names and addresses.
 */
import {
  generateDeVat,
  generateFrIdentifiers,
  generateItPartitaIva,
  generatePlNip,
  generatePtNif,
} from './identifiers';
import { SupportedCountryCode } from './data-pools';
import { Rng, intBetween } from './rng';

export interface PartyIdentifierEntry {
  scheme: 'LEGAL_ID' | 'VAT' | 'RC' | 'NIS' | 'NIF' | 'AI';
  value: string;
}

/** Same general shape as the fixtures `e2e/cypress/e2e/113-algeria-onboarding-and-currency.cy.ts`
 *  already types by hand for its own Algerian company/client, randomized per-digit so two demo
 *  parties never collide. No checksum (see this file's own header on RC/NIS/NIF/AI). NIS and NIF are
 *  each built to exactly 15 digits, the shorter of the two lengths `country-identifiers/data/dz.json`
 *  now declares a `pattern` for (NIF `^\d{15}(\d{5})?$`, NIS `^\d{15}(\d{3})?$`, both from PR #566's
 *  review, native contributor, 2026-09-30). A demo party is always a primary establishment, never a
 *  secondary one, so the longer (20/18-digit) branch is never exercised here. */
function generateDzIdentifiers(rng: Rng): PartyIdentifierEntry[] {
  const digits = (count: number) => Array.from({ length: count }, () => intBetween(rng, 0, 9)).join('');
  const wilaya = String(intBetween(rng, 1, 58)).padStart(2, '0');
  const year = 2000 + intBetween(rng, 15, 26);
  return [
    { scheme: 'RC', value: `${wilaya}/00-${digits(7)}B${String(year).slice(-2)}` },
    { scheme: 'NIS', value: `${wilaya}${digits(13)}` }, // 2 + 13 = 15 digits
    { scheme: 'NIF', value: `000${wilaya}${digits(10)}` }, // 3 + 2 + 10 = 15 digits
    { scheme: 'AI', value: `${wilaya}/${year}` },
  ];
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
    case 'DZ':
      return generateDzIdentifiers(rng);
  }
}

/** The value a document line's `vatRate` (a 'select' field, `usesVatRateCatalog: true`) must carry to
 *  resolve to this country's own STANDARD rate: every shipped `vat-rates/data/<cc>.json` names its
 *  standard-category rate `"<cc>-standard"` (lowercase), confirmed by reading all five files directly
 *  before this was written. */
export function standardVatRateId(countryCode: SupportedCountryCode): string {
  return `${countryCode.toLowerCase()}-standard`;
}
