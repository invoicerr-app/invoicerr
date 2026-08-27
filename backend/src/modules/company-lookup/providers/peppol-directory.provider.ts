/**
 * Peppol Directory — the public index of Peppol participants (OpenPeppol).
 *
 * Endpoint : GET https://directory.peppol.eu/search/1.0/json?q={identifier}
 * Docs     : https://directory.peppol.eu/public/menuitem-docs-rest-api
 * Credentials: none.
 *
 * Worldwide and keyless. It answers a question no register does: *is this company
 * reachable over Peppol, and under which participant id* — exactly what the invoice
 * pipeline needs before it picks a transmission channel. The trade-off is coverage:
 * only businesses that registered a Peppol endpoint are listed, so it runs last.
 */
import { alnum, digits, fetchJson, toDate } from '../http';
import {
  CompanyLookupCompany,
  CompanyLookupQuery,
  CompanyRegistryProvider,
  LookupScheme,
  ProviderCoverage,
} from '../types';

const DIRECTORY_URL = 'https://directory.peppol.eu/search/1.0/json';

export class PeppolDirectoryProvider implements CompanyRegistryProvider {
  readonly id = 'peppol-directory';
  readonly label = 'Peppol Directory';
  readonly countries = 'ALL' as const;
  readonly coverage: ProviderCoverage = 'PARTIAL';
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'Registration or VAT number';
  readonly docsUrl = 'https://directory.peppol.eu/public/menuitem-docs-rest-api';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (!/^[A-Z]{2}$/.test(query.countryCode.toUpperCase())) return false;
    return alnum(query.value).length >= 6;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const country = query.countryCode.toUpperCase();
    // The directory indexes the bare identifier value, prefix-free.
    const needle = digits(query.value) || alnum(query.value);
    const data = await fetchJson<any>(`${DIRECTORY_URL}?q=${encodeURIComponent(needle)}`, {
      timeoutMs: this.timeoutMs,
    });

    const matches: any[] = data?.matches ?? [];
    for (const match of matches) {
      const entity = (match.entities ?? []).find(
        (e: any) => !e.countryCode || String(e.countryCode).toUpperCase() === country,
      );
      if (!entity) continue;

      const name = entity.name?.[0]?.name ?? (Array.isArray(entity.name) ? undefined : entity.name);
      if (!name) continue;

      // participantID is "scheme:value", e.g. "0184:25313763" (DK CVR).
      const participantValue = String(match.participantID?.value ?? '');
      const localId = participantValue.includes(':') ? participantValue.split(':').pop() : participantValue;

      return {
        name,
        legalName: name,
        legalId: entity.identifiers?.[0]?.value ?? localId,
        legalIdScheme: entity.identifiers?.[0]?.scheme,
        // geoInfo is free text: sometimes a city, often just the country code again.
        city: entity.geoInfo && String(entity.geoInfo).toUpperCase() !== country ? entity.geoInfo : undefined,
        countryCode: String(entity.countryCode ?? country).toUpperCase(),
        // A directory listing means the participant is live on the network today.
        status: 'ACTIVE',
      };
    }
    return null;
  }
}
