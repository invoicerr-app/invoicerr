/**
 * Slovakia — RPO (Register právnických osôb, Štatistický úrad SR).
 *
 * Endpoint : GET https://api.statistics.sk/rpo/v1/search?identifier={ico}
 * Docs     : https://susrrpo.docs.apiary.io/
 * Credentials: none.
 *
 * The RPO answers with the entity's full history (every name, every seat, each with
 * a validity range), so every field has to be narrowed to the entry in force today.
 */
import { digits, fetchJson, stripVatPrefix, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const RPO_URL = 'https://api.statistics.sk/rpo/v1/search';

/** Picks the still-open entry, or the most recent one when everything is closed. */
export function currentEntry(list: any[] | undefined): any | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const open = list.filter((e) => !e.validTo);
  const pool = open.length > 0 ? open : list;
  return [...pool].sort((a, b) => String(b.validFrom ?? '').localeCompare(String(a.validFrom ?? '')))[0];
}

export class SlovakRpoProvider implements CompanyRegistryProvider {
  readonly id = 'sk-rpo';
  readonly label = 'RPO (Štatistický úrad SR)';
  readonly countries = ['SK'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'IČO (8 digits) or IČ DPH';
  readonly docsUrl = 'https://susrrpo.docs.apiary.io/';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'SK') return false;
    // SK VAT is SK + 10 digits; the register itself is keyed on the 8-digit IČO.
    return digits(stripVatPrefix(query.value, 'SK')).length >= 6;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const ico = digits(stripVatPrefix(query.value, 'SK')).padStart(8, '0').slice(-8);
    const data = await fetchJson<any>(`${RPO_URL}?identifier=${ico}`, { timeoutMs: this.timeoutMs });
    const entity = data?.results?.[0];
    if (!entity) return null;

    const name = currentEntry(entity.fullNames)?.value;
    const addr = currentEntry(entity.addresses);
    return {
      name: name ?? ico,
      legalId: currentEntry(entity.identifiers)?.value ?? ico,
      legalIdScheme: 'ICO',
      address: addr ? join(addr.street, addr.buildingNumber) : undefined,
      postalCode: addr?.postalCodes?.[0],
      city: addr?.municipality?.value,
      country: addr?.country?.value ?? 'Slovenská republika',
      countryCode: 'SK',
      foundedAt: toDate(entity.establishment?.validFrom ?? currentEntry(entity.identifiers)?.validFrom),
      status: entity.termination ? 'INACTIVE' : 'ACTIVE',
    };
  }
}
