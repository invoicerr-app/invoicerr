/**
 * Netherlands — KVK Handelsregister.
 *
 * Endpoint : GET https://api.kvk.nl/api/v2/zoeken?kvkNummer={n}   (header `apikey`)
 * Docs     : https://developers.kvk.nl/
 * Credentials: KVK_API_KEY (free test key, paid production key).
 *
 * The KVK number is not the VAT number: Dutch VAT (BTW-id) is issued separately by
 * the Belastingdienst, so it is left to VIES.
 */
import { digits, fetchJson } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const KVK_URL = 'https://api.kvk.nl/api/v2/zoeken';

export class NetherlandsKvkProvider implements CompanyRegistryProvider {
  readonly id = 'nl-kvk';
  readonly label = 'KVK Handelsregister';
  readonly countries = ['NL'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID'];
  readonly identifierLabel = 'KVK-nummer (8 digits)';
  readonly docsUrl = 'https://developers.kvk.nl/';
  readonly credentialEnvVars = ['KVK_API_KEY'] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return !!process.env.KVK_API_KEY;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'NL') return false;
    return digits(query.value).length === 8;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const kvk = digits(query.value);
    const data = await fetchJson<any>(`${KVK_URL}?kvkNummer=${kvk}`, {
      timeoutMs: this.timeoutMs,
      headers: { apikey: process.env.KVK_API_KEY as string },
    });
    const item = data?.resultaten?.[0];
    if (!item?.kvkNummer) return null;

    const addr = item.adres?.binnenlandsAdres ?? item.adres ?? {};
    return {
      name: item.naam,
      legalId: String(item.kvkNummer),
      legalIdScheme: 'KVK',
      address: join(addr.straatnaam, addr.huisnummer, addr.huisnummerToevoeging),
      postalCode: addr.postcode,
      city: addr.plaats,
      country: 'Nederland',
      countryCode: 'NL',
      status: 'ACTIVE',
    };
  }
}
