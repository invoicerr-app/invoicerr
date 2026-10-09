/**
 * Vietnam — business registration data (Tổng cục Thuế / national business register),
 * read through VietQR's public mirror.
 *
 * Endpoint : GET https://api.vietqr.io/v2/business/{taxCode}
 * Docs     : https://www.vietqr.io/danh-sach-api/api-tra-cuu-thong-tin-doanh-nghiep/
 * Credentials: none.
 *
 * Vietnam publishes no direct API: masothue/dangkykinhdoanh are HTML only. This is a
 * third-party mirror (same posture as cvrapi.dk for Denmark) — the tax code leaves the
 * instance, which is why the country note says so.
 */
import { defaultLookupCoverage } from '../coverage/registry';
import { digits, fetchJson } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';

const VIETQR_URL = 'https://api.vietqr.io/v2/business';

export class VietnamTaxCodeProvider implements CompanyRegistryProvider {
  readonly id = 'vn-tax-code';
  readonly label = 'Mã số thuế (VietQR mirror)';
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'Mã số thuế (10 or 13 digits)';
  readonly docsUrl = 'https://www.vietqr.io/danh-sach-api/api-tra-cuu-thong-tin-doanh-nghiep/';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (!defaultLookupCoverage.serves(this.id, query.countryCode)) return false;
    const n = digits(query.value).length;
    return n === 10 || n === 13;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const taxCode = digits(query.value);
    const data = await fetchJson<any>(`${VIETQR_URL}/${taxCode}`, {
      timeoutMs: this.timeoutMs,
      notFoundStatuses: [404],
    });
    const entity = data?.data;
    if (!entity?.name) return null;

    return {
      name: entity.shortName || entity.name,
      legalName: entity.name,
      legalId: entity.id ?? taxCode,
      legalIdScheme: 'TAX_CODE',
      VAT: entity.id ?? taxCode,
      address: entity.address,
      country: 'Việt Nam',
      countryCode: query.countryCode.toUpperCase(),
      // "NNT đang hoạt động" = taxpayer currently trading.
      status: /đang hoạt động/i.test(entity.status ?? '') ? 'ACTIVE' : 'UNKNOWN',
    };
  }
}
