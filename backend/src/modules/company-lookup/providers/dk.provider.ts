/**
 * Denmark — CVR (Det Centrale Virksomhedsregister), read through cvrapi.dk.
 *
 * Endpoint : GET https://cvrapi.dk/api?search={cvr}&country=dk
 * Docs     : https://cvrapi.dk/documentation
 * Credentials: none — but a descriptive User-Agent is mandatory (set in http.ts).
 */
import { digits, fetchJson, stripVatPrefix, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const CVRAPI_URL = 'https://cvrapi.dk/api';

export class DenmarkCvrProvider implements CompanyRegistryProvider {
  readonly id = 'dk-cvr';
  readonly label = 'CVR (Det Centrale Virksomhedsregister)';
  readonly countries = ['DK'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'CVR-nummer (8 digits)';
  readonly docsUrl = 'https://cvrapi.dk/documentation';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'DK') return false;
    return digits(stripVatPrefix(query.value, 'DK')).length === 8;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const cvr = digits(stripVatPrefix(query.value, 'DK'));
    const data = await fetchJson<any>(`${CVRAPI_URL}?search=${cvr}&country=dk`, {
      timeoutMs: this.timeoutMs,
      notFoundStatuses: [404],
    });
    if (!data?.vat) return null;

    // In Denmark the CVR number *is* the VAT number.
    return {
      name: data.name,
      legalId: String(data.vat),
      legalIdScheme: 'CVR',
      VAT: `DK${data.vat}`,
      address: join(data.address, data.addressco),
      postalCode: data.zipcode ? String(data.zipcode) : undefined,
      city: data.city ?? data.cityname,
      country: 'Danmark',
      countryCode: 'DK',
      foundedAt: toDate(data.startdate),
      status: data.enddate ? 'INACTIVE' : 'ACTIVE',
      vatRegistered: true,
    };
  }
}
