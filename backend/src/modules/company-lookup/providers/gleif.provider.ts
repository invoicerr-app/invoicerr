/**
 * GLEIF — the Global LEI Index (Global Legal Entity Identifier Foundation).
 *
 * Endpoint : GET https://api.gleif.org/api/v1/lei-records
 *            ?filter[entity.registeredAs]={id}&filter[entity.legalAddress.country]={cc}
 *            GET https://api.gleif.org/api/v1/lei-records/{lei}
 * Docs     : https://www.gleif.org/en/lei-data/gleif-api
 * Credentials: none, no registration, no quota key.
 *
 * Worldwide, not per country: ~2.8 M legal entities across ~200 jurisdictions, each
 * carrying the number it is registered as in its own national register. That makes it
 * the keyless fallback for every country that has no open register API of its own.
 *
 * Coverage is PARTIAL by nature — an entity is in the index only if it obtained an LEI
 * (anyone trading securities, most mid/large companies, few micro-businesses), so a miss
 * here is not evidence that the company does not exist.
 */
import { alnum, digits, fetchJson, stripVatPrefix, toDate } from '../http';
import {
  CompanyLookupCompany,
  CompanyLookupQuery,
  CompanyRegistryProvider,
  LookupScheme,
  ProviderCoverage,
} from '../types';

const GLEIF_URL = 'https://api.gleif.org/api/v1/lei-records';

/** An LEI is 20 alphanumeric characters (ISO 17442). */
export function isLei(value: string): boolean {
  return /^[0-9A-Z]{20}$/.test(alnum(value));
}

export class GleifProvider implements CompanyRegistryProvider {
  readonly id = 'gleif';
  readonly label = 'GLEIF (Global LEI Index)';
  readonly countries = 'ALL' as const;
  readonly coverage: ProviderCoverage = 'PARTIAL';
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'Registration number or LEI';
  readonly docsUrl = 'https://www.gleif.org/en/lei-data/gleif-api';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (!/^[A-Z]{2}$/.test(query.countryCode.toUpperCase())) return false;
    if (isLei(query.value)) return true;
    // Registration numbers are stored as typed by the registrar; require enough signal.
    return alnum(query.value).length >= 4;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const country = query.countryCode.toUpperCase();
    const record = isLei(query.value)
      ? await this.byLei(alnum(query.value))
      : await this.byRegistrationNumber(query.value, country);
    if (!record) return null;

    const attributes = record.attributes ?? {};
    const entity = attributes.entity ?? {};
    const address = entity.legalAddress ?? entity.headquartersAddress ?? {};

    return {
      name: entity.legalName?.name,
      legalName: entity.legalName?.name,
      legalId: entity.registeredAs ?? undefined,
      legalIdScheme: entity.registeredAs ? 'REGISTRATION_NUMBER' : undefined,
      address: Array.isArray(address.addressLines)
        ? address.addressLines.filter(Boolean).join(', ')
        : undefined,
      postalCode: address.postalCode ?? undefined,
      city: address.city ?? undefined,
      // GLEIF regions are ISO 3166-2 ("CZ-10"); keep only the subdivision part.
      state: typeof address.region === 'string' ? address.region.split('-').pop() : undefined,
      countryCode: address.country ?? country,
      foundedAt: toDate(entity.creationDate?.slice(0, 10)),
      status: entity.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    };
  }

  private async byLei(lei: string): Promise<any | null> {
    const data = await fetchJson<any>(`${GLEIF_URL}/${lei}`, { timeoutMs: this.timeoutMs });
    return data?.data ?? null;
  }

  /**
   * Registration numbers repeat across jurisdictions, so the country is part of the
   * query. Both the raw input and its digits-only form are tried: registrars store
   * SIREN-style numbers bare but IČO/NIP-style ones sometimes with separators.
   */
  private async byRegistrationNumber(value: string, country: string): Promise<any | null> {
    const candidates = [...new Set([alnum(value), digits(value), stripVatPrefix(value, country)])].filter(
      (v) => v.length >= 4,
    );
    for (const candidate of candidates) {
      const url =
        `${GLEIF_URL}?filter%5Bentity.registeredAs%5D=${encodeURIComponent(candidate)}` +
        `&filter%5Bentity.legalAddress.country%5D=${country}&page%5Bsize%5D=1`;
      const data = await fetchJson<any>(url, { timeoutMs: this.timeoutMs });
      const record = data?.data?.[0];
      if (record) return record;
    }
    return null;
  }
}
