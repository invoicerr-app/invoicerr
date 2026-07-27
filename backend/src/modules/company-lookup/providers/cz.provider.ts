/**
 * Czechia — ARES (Administrativní registr ekonomických subjektů, Ministerstvo financí).
 *
 * Endpoint : GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}
 * Docs     : https://ares.gov.cz/stranky/vyvojar-info
 * Credentials: none.
 */
import { digits, fetchJson, stripVatPrefix, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const ARES_URL = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';

/** IČO: 8 digits, weighted mod-11 checksum. */
export function isValidIco(value: string): boolean {
  const clean = digits(value).padStart(8, '0');
  if (clean.length !== 8) return false;
  const sum = [8, 7, 6, 5, 4, 3, 2].reduce((acc, w, i) => acc + w * parseInt(clean[i], 10), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 1 : rest === 1 ? 0 : 11 - rest;
  return check === parseInt(clean[7], 10);
}

export class CzechAresProvider implements CompanyRegistryProvider {
  readonly id = 'cz-ares';
  readonly label = 'ARES (Ministerstvo financí)';
  readonly countries = ['CZ'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'IČO (8 digits) or DIČ';
  readonly docsUrl = 'https://ares.gov.cz/stranky/vyvojar-info';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'CZ') return false;
    return isValidIco(stripVatPrefix(query.value, 'CZ'));
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const ico = digits(stripVatPrefix(query.value, 'CZ')).padStart(8, '0');
    const data = await fetchJson<any>(`${ARES_URL}/${ico}`, { timeoutMs: this.timeoutMs });
    if (!data?.ico) return null;

    const sidlo = data.sidlo ?? {};
    return {
      name: data.obchodniJmeno,
      legalId: data.ico,
      legalIdScheme: 'ICO',
      VAT: data.dic ?? undefined,
      // textovaAdresa is "street, quarter, postcode city" — the tail duplicates the fields below.
      address: sidlo.textovaAdresa
        ? String(sidlo.textovaAdresa).split(',').slice(0, -1).join(',').trim() || sidlo.textovaAdresa
        : join(sidlo.nazevUlice, sidlo.cisloDomovni),
      postalCode: sidlo.psc ? String(sidlo.psc).padStart(5, '0') : undefined,
      city: sidlo.nazevObce,
      state: sidlo.nazevKraje,
      country: sidlo.nazevStatu ?? 'Česká republika',
      countryCode: 'CZ',
      foundedAt: toDate(data.datumVzniku),
      status: data.datumZaniku ? 'INACTIVE' : 'ACTIVE',
      vatRegistered: data.dic ? true : null,
    };
  }
}
