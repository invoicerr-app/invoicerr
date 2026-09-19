/**
 * United Kingdom — Companies House public data API.
 *
 * Endpoint : GET https://api.company-information.service.gov.uk/company/{number}
 *            HTTP Basic, the API key as the username and an empty password.
 * Docs     : https://developer.company-information.service.gov.uk/
 * Credentials: COMPANIES_HOUSE_API_KEY (free registration).
 *
 * Companies House holds no VAT data — HMRC's VAT checker is a separate service —
 * so this provider only answers on the company number.
 */
import { fetchJson, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const COMPANIES_HOUSE_URL = 'https://api.company-information.service.gov.uk/company';

export class UkCompaniesHouseProvider implements CompanyRegistryProvider {
  readonly id = 'gb-companies-house';
  readonly label = 'Companies House';
  readonly countries = ['GB'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID'];
  readonly identifierLabel = 'Company number (8 characters)';
  readonly docsUrl = 'https://developer.company-information.service.gov.uk/';
  readonly credentialEnvVars = ['COMPANIES_HOUSE_API_KEY'] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return !!process.env.COMPANIES_HOUSE_API_KEY;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'GB') return false;
    return /^[A-Z0-9]{6,8}$/.test(this.normalize(query.value));
  }

  /** Numeric numbers are zero-padded to 8; prefixed ones (SC, NI, OC…) are kept as typed. */
  private normalize(value: string): string {
    const clean = (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return /^\d+$/.test(clean) ? clean.padStart(8, '0') : clean;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const number = this.normalize(query.value);
    const auth = Buffer.from(`${process.env.COMPANIES_HOUSE_API_KEY}:`).toString('base64');
    const data = await fetchJson<any>(`${COMPANIES_HOUSE_URL}/${number}`, {
      timeoutMs: this.timeoutMs,
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!data?.company_number) return null;

    const addr = data.registered_office_address ?? {};
    return {
      name: data.company_name,
      legalId: data.company_number,
      legalIdScheme: 'COMPANY_NUMBER',
      address: join(addr.address_line_1, addr.address_line_2),
      postalCode: addr.postal_code,
      city: addr.locality,
      state: addr.region,
      country: addr.country ?? 'United Kingdom',
      countryCode: 'GB',
      foundedAt: toDate(data.date_of_creation),
      status: data.company_status === 'active' ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
