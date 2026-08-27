/**
 * Poland — Wykaz podatników VAT ("biała lista", Ministerstwo Finansów).
 *
 * Endpoint : GET https://wl-api.mf.gov.pl/api/search/nip/{nip}?date=YYYY-MM-DD
 * Docs     : https://www.podatki.gov.pl/wykaz-podatnikow-vat-wyszukiwarka/api/
 * Credentials: none.
 *
 * The `date` is mandatory and must not be in the future in Polish local time — the
 * register answers "as of" that day, which is also how it reports VAT status.
 */
import { digits, fetchJson, stripVatPrefix, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { localDate } from './shared';

const WL_URL = 'https://wl-api.mf.gov.pl/api/search/nip';

/** NIP: 10 digits, weighted mod-11 checksum (weights 6,5,7,2,3,4,5,6,7). */
export function isValidNip(value: string): boolean {
  const clean = digits(value);
  if (clean.length !== 10) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * parseInt(clean[i], 10), 0);
  const check = sum % 11;
  return check !== 10 && check === parseInt(clean[9], 10);
}

/** "ŚWIĘTOKRZYSKA 12, 00-916 WARSZAWA" → street / postal code / city. */
export function parsePolishAddress(raw: string | undefined): {
  address?: string;
  postalCode?: string;
  city?: string;
} {
  if (!raw) return {};
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  const tail = parts[parts.length - 1];
  const m = /^(\d{2}-\d{3})\s+(.+)$/.exec(tail);
  if (!m) return { address: raw };
  return { address: parts.slice(0, -1).join(', ') || undefined, postalCode: m[1], city: m[2] };
}

export class PolandWykazProvider implements CompanyRegistryProvider {
  readonly id = 'pl-wykaz-vat';
  readonly label = 'Wykaz podatników VAT (Ministerstwo Finansów)';
  readonly countries = ['PL'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'NIP (10 digits)';
  readonly docsUrl = 'https://www.podatki.gov.pl/wykaz-podatnikow-vat-wyszukiwarka/api/';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'PL') return false;
    return isValidNip(stripVatPrefix(query.value, 'PL'));
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const nip = digits(stripVatPrefix(query.value, 'PL'));
    const date = localDate('Europe/Warsaw');
    const data = await fetchJson<any>(`${WL_URL}/${nip}?date=${date}`, { timeoutMs: this.timeoutMs });
    const subject = data?.result?.subject;
    if (!subject) return null;

    const { address, postalCode, city } = parsePolishAddress(
      subject.workingAddress ?? subject.residenceAddress,
    );
    return {
      name: subject.name,
      legalId: subject.nip,
      legalIdScheme: 'NIP',
      VAT: subject.nip ? `PL${subject.nip}` : undefined,
      address,
      postalCode,
      city,
      country: 'Polska',
      countryCode: 'PL',
      foundedAt: toDate(subject.registrationLegalDate),
      status: subject.statusVat === 'Czynny' ? 'ACTIVE' : 'UNKNOWN',
      vatRegistered: subject.statusVat ? subject.statusVat === 'Czynny' : null,
    };
  }
}
