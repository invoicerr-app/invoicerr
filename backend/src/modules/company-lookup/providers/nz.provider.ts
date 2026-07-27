/**
 * New Zealand — NZBN register (Ministry of Business, Innovation and Employment).
 *
 * Endpoint : GET https://api.business.govt.nz/gateway/nzbn/v5/entities/{nzbn}
 *            header `Ocp-Apim-Subscription-Key`
 * Docs     : https://api.business.govt.nz/api-details#api=nzbn-v5
 * Credentials: NZBN_API_KEY (free subscription).
 */
import { digits, fetchJson, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const NZBN_URL = 'https://api.business.govt.nz/gateway/nzbn/v5/entities';

export class NewZealandNzbnProvider implements CompanyRegistryProvider {
  readonly id = 'nz-nzbn';
  readonly label = 'NZBN register (MBIE)';
  readonly countries = ['NZ'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID'];
  readonly identifierLabel = 'NZBN (13 digits)';
  readonly docsUrl = 'https://api.business.govt.nz/api-details#api=nzbn-v5';
  readonly credentialEnvVars = ['NZBN_API_KEY'] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return !!process.env.NZBN_API_KEY;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'NZ') return false;
    return digits(query.value).length === 13;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const nzbn = digits(query.value);
    const data = await fetchJson<any>(`${NZBN_URL}/${nzbn}`, {
      timeoutMs: this.timeoutMs,
      headers: { 'Ocp-Apim-Subscription-Key': process.env.NZBN_API_KEY as string },
    });
    if (!data?.nzbn && !data?.entityName) return null;

    const addresses = data.addresses?.addressList ?? [];
    const addr =
      addresses.find((a: any) => a.addressType === 'REGISTERED') ??
      addresses.find((a: any) => a.addressType === 'SERVICE') ??
      addresses[0] ??
      {};

    return {
      name: data.entityName,
      legalId: String(data.nzbn ?? nzbn),
      legalIdScheme: 'NZBN',
      address: join(addr.address1, addr.address2),
      postalCode: addr.postCode ? String(addr.postCode) : undefined,
      city: addr.address3 ?? addr.address4,
      country: addr.countryCode ?? 'New Zealand',
      countryCode: 'NZ',
      foundedAt: toDate(data.registrationDate),
      status: /registered|active/i.test(data.entityStatusDescription ?? '') ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
