/**
 * Switzerland (and Liechtenstein) — Zefix, the central business name index.
 *
 * Endpoint : GET https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/uid/{uid}
 *            HTTP Basic with the account granted by the Federal Office of Justice.
 * Docs     : https://www.zefix.admin.ch/ZefixPublicREST/
 * Credentials: ZEFIX_USER + ZEFIX_PASSWORD.
 *
 * Liechtenstein companies also carry a CHE UID and are served by the same index.
 */
import { defaultLookupCoverage } from '../coverage/registry';
import { digits, fetchJson } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const ZEFIX_URL = 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/uid';
// Zefix answers in German, so the country is named in German too.
const ZEFIX_COUNTRY_NAMES = new Intl.DisplayNames(['de'], { type: 'region' });

export class SwitzerlandZefixProvider implements CompanyRegistryProvider {
  readonly id = 'ch-zefix';
  readonly label = 'Zefix (Zentraler Firmenindex)';
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'UID (CHE-123.456.789)';
  readonly docsUrl = 'https://www.zefix.admin.ch/ZefixPublicREST/';
  readonly credentialEnvVars = ['ZEFIX_USER', 'ZEFIX_PASSWORD'] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return !!process.env.ZEFIX_USER && !!process.env.ZEFIX_PASSWORD;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (!defaultLookupCoverage.serves(this.id, query.countryCode)) return false;
    return digits(query.value).length === 9;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const uid = `CHE${digits(query.value)}`;
    const auth = Buffer.from(`${process.env.ZEFIX_USER}:${process.env.ZEFIX_PASSWORD}`).toString('base64');
    const data = await fetchJson<any>(`${ZEFIX_URL}/${uid}`, {
      timeoutMs: this.timeoutMs,
      headers: { Authorization: `Basic ${auth}` },
    });
    const company = Array.isArray(data) ? data[0] : data;
    if (!company?.name) return null;

    const addr = company.address ?? {};
    return {
      name: company.name,
      legalId: company.uid ?? uid,
      legalIdScheme: 'UID',
      // The MWST number is the UID plus a suffix; only the register's flag is authoritative.
      VAT: company.vatRegistered ? `${uid} MWST` : undefined,
      address: join(addr.street, addr.houseNumber),
      postalCode: addr.swissZipCode ? String(addr.swissZipCode) : addr.foreignZipCode,
      city: addr.city ?? company.legalSeat,
      country: ZEFIX_COUNTRY_NAMES.of(query.countryCode.toUpperCase()),
      countryCode: query.countryCode.toUpperCase(),
      status: company.status === 'ACTIVE' || company.deleteDate == null ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
