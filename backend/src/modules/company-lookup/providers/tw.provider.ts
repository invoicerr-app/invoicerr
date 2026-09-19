/**
 * Taiwan — 商工登記公示資料 (Ministry of Economic Affairs, GCIS open data).
 *
 * Endpoint : GET https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6
 *            ?$format=json&$filter=Business_Accounting_NO eq {ban}&$skip=0&$top=1
 * Docs     : https://data.gcis.nat.gov.tw/main/api
 * Credentials: none.
 *
 * The 統一編號 (BAN, "unified business number") is both the registration number and the
 * tax number. Dates come back in the Minguo calendar — "0760221" is 1987-02-21.
 */
import { digits, fetchJson } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';

const GCIS_URL = 'https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6';

/**
 * BAN checksum (MOEA): weights 1,2,1,2,1,2,4,1; each product's digits are summed.
 * The total must be divisible by 5 — or, when the 7th digit is 7, by 5 after adding 1.
 */
export function isValidBan(value: string): boolean {
  const clean = digits(value);
  if (clean.length !== 8) return false;
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const product = parseInt(clean[i], 10) * weights[i];
    sum += Math.floor(product / 10) + (product % 10);
  }
  if (sum % 5 === 0) return true;
  return clean[6] === '7' && (sum + 1) % 5 === 0;
}

/** Minguo (ROC) date "0760221" → 1987-02-21. Year 0 of the ROC era is 1911 CE. */
export function fromMinguoDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{6,7}$/.test(value)) return undefined;
  const padded = value.padStart(7, '0');
  const year = parseInt(padded.slice(0, 3), 10) + 1911;
  const month = padded.slice(3, 5);
  const day = padded.slice(5, 7);
  const d = new Date(`${year}-${month}-${day}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export class TaiwanGcisProvider implements CompanyRegistryProvider {
  readonly id = 'tw-gcis';
  readonly label = '商工登記公示資料 (經濟部 GCIS)';
  readonly countries = ['TW'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = '統一編號 (8 digits)';
  readonly docsUrl = 'https://data.gcis.nat.gov.tw/main/api';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'TW') return false;
    return isValidBan(query.value);
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const ban = digits(query.value);
    const filter = encodeURIComponent(`Business_Accounting_NO eq ${ban}`);
    const data = await fetchJson<any[]>(`${GCIS_URL}?$format=json&$filter=${filter}&$skip=0&$top=1`, {
      timeoutMs: this.timeoutMs,
    });
    const company = Array.isArray(data) ? data[0] : undefined;
    if (!company?.Business_Accounting_NO) return null;

    return {
      name: company.Company_Name,
      legalId: company.Business_Accounting_NO,
      legalIdScheme: 'BAN',
      VAT: company.Business_Accounting_NO,
      // The register publishes one free-text address line, city included.
      address: company.Company_Location,
      country: '臺灣',
      countryCode: 'TW',
      foundedAt: fromMinguoDate(company.Company_Setup_Date),
      // 核准設立 = approved and registered; anything else (撤銷, 廢止, 解散) is gone.
      status: /核准設立/.test(company.Company_Status_Desc ?? '') ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
