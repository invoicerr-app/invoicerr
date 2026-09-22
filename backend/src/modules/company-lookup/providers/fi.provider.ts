/**
 * Finland — PRH / YTJ open data (Patentti- ja rekisterihallitus).
 *
 * Endpoint : GET https://avoindata.prh.fi/opendata-ytj-api/v3/companies?businessId={id}
 * Docs     : https://avoindata.prh.fi/ytj_en.html
 * Credentials: none.
 *
 * The Finnish VAT number is the business id without its dash, prefixed with FI.
 */
import { digits, fetchJson, stripVatPrefix, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const PRH_URL = 'https://avoindata.prh.fi/opendata-ytj-api/v3/companies';

/** Y-tunnus is 7 digits + '-' + check digit; users type it either way. */
export function formatBusinessId(value: string): string | null {
  const clean = digits(value);
  if (clean.length < 7 || clean.length > 8) return null;
  const padded = clean.padStart(8, '0');
  return `${padded.slice(0, 7)}-${padded.slice(7)}`;
}

export class FinlandPrhProvider implements CompanyRegistryProvider {
  readonly id = 'fi-prh';
  readonly label = 'PRH / YTJ (avoindata)';
  readonly countries = ['FI'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'Y-tunnus (1234567-8)';
  readonly docsUrl = 'https://avoindata.prh.fi/ytj_en.html';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'FI') return false;
    return formatBusinessId(stripVatPrefix(query.value, 'FI')) !== null;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const businessId = formatBusinessId(stripVatPrefix(query.value, 'FI'));
    if (!businessId) return null;

    const data = await fetchJson<any>(`${PRH_URL}?businessId=${businessId}`, { timeoutMs: this.timeoutMs });
    const company = data?.companies?.[0];
    if (!company) return null;

    // names: type '1' = the current company name. addresses: type 1 = visiting, 2 = postal.
    const names = (company.names ?? []).filter((n: any) => String(n.type) === '1' && !n.endDate);
    const name = (names[0] ?? company.names?.[0])?.name;
    const addresses = company.addresses ?? [];
    const addr = addresses.find((a: any) => Number(a.type) === 1) ?? addresses[0] ?? {};
    // languageCode 1 = Finnish, 2 = Swedish; both name the same place.
    const office =
      (addr.postOffices ?? []).find((p: any) => String(p.languageCode) === '1') ?? addr.postOffices?.[0];

    return {
      name: name ?? businessId,
      legalId: company.businessId?.value ?? businessId,
      legalIdScheme: 'BUSINESS_ID',
      VAT: `FI${digits(businessId)}`,
      address: join(addr.street, addr.buildingNumber, addr.apartmentNumber),
      postalCode: addr.postCode,
      city: office?.city,
      country: 'Suomi',
      countryCode: 'FI',
      foundedAt: toDate(company.businessId?.registrationDate ?? company.registrationDate),
      status: company.status && String(company.status) !== '2' ? 'ACTIVE' : 'UNKNOWN',
    };
  }
}
