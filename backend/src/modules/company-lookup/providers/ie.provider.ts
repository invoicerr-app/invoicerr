/**
 * Ireland — CRO (Companies Registration Office) Company Web Services.
 *
 * Endpoint : GET https://services.cro.ie/cws/companies?company_num={n}&format=json
 *            HTTP Basic with the account e-mail and the API key.
 * Docs     : https://services.cro.ie/
 * Credentials: CRO_API_USER + CRO_API_KEY (free registration).
 */
import { digits, fetchJson, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const CRO_URL = 'https://services.cro.ie/cws/companies';

export class IrelandCroProvider implements CompanyRegistryProvider {
  readonly id = 'ie-cro';
  readonly label = 'CRO (Companies Registration Office)';
  readonly countries = ['IE'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID'];
  readonly identifierLabel = 'CRO company number';
  readonly docsUrl = 'https://services.cro.ie/';
  readonly credentialEnvVars = ['CRO_API_USER', 'CRO_API_KEY'] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return !!process.env.CRO_API_USER && !!process.env.CRO_API_KEY;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'IE') return false;
    const n = digits(query.value).length;
    return n >= 4 && n <= 7;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const num = digits(query.value);
    const auth = Buffer.from(`${process.env.CRO_API_USER}:${process.env.CRO_API_KEY}`).toString('base64');
    const data = await fetchJson<any>(`${CRO_URL}?company_num=${num}&format=json`, {
      timeoutMs: this.timeoutMs,
      headers: { Authorization: `Basic ${auth}` },
    });
    const company = Array.isArray(data) ? data[0] : data?.[0];
    if (!company?.company_num) return null;

    return {
      name: company.company_name,
      legalId: String(company.company_num),
      legalIdScheme: 'CRO_NUMBER',
      address: join(company.company_addr_1, company.company_addr_2, company.company_addr_3),
      postalCode: company.eircode,
      city: company.company_addr_4,
      country: 'Ireland',
      countryCode: 'IE',
      foundedAt: toDate(company.company_reg_date),
      status: /dissolved|struck/i.test(company.company_status_desc ?? '') ? 'INACTIVE' : 'ACTIVE',
    };
  }
}
