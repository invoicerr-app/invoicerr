/**
 * VIES — the EU-wide VAT number validation service (European Commission).
 *
 * Endpoint : GET https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{MS}/vat/{number}
 * Docs     : https://ec.europa.eu/taxation_customs/vies/#/technical-information
 * Credentials: none.
 *
 * Coverage note — VIES always answers "is this VAT number valid", but the name and
 * address are only returned by the member states that opt to disclose them (IT and
 * most of the smaller MS do; DE and ES return "---"). We surface whatever is given
 * and fall back to a VAT-validity-only answer, which is still worth showing: it
 * confirms the number and the registration before an invoice is issued.
 *
 * Rate limits are per member state and unpublished; the service returns
 * `userError: MS_MAX_CONCURRENT_REQ` when a MS is saturated — treated as an error
 * (retryable) rather than as "not found".
 */
import { fetchJson, stripVatPrefix } from '../http';
import {
  CompanyLookupCompany,
  CompanyLookupQuery,
  CompanyRegistryProvider,
  LookupScheme,
  ProviderLookupError,
} from '../types';

const VIES_BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';

/** EU member states + XI (Northern Ireland, post-Brexit protocol). */
export const VIES_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'XI',
] as const;

/** VIES addresses the member state as EL for Greece, XI for Northern Ireland. */
function viesMemberState(countryCode: string): string {
  const cc = countryCode.toUpperCase();
  return cc === 'GR' ? 'EL' : cc;
}

/** "---" is the VIES sentinel for "this member state does not disclose the field". */
function disclosed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^-+$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * VIES returns the address as one free-text blob, formatted the way the member
 * state formats it. Best-effort split: everything but the last line is the street,
 * the last line usually starts with the postal code.
 */
export function parseViesAddress(address: string | undefined): {
  address?: string;
  postalCode?: string;
  city?: string;
} {
  if (!address) return {};
  const lines = address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return {};

  // Single-line variants: "ul. Świętokrzyska 12, 00-916 Warszawa"
  const parts =
    lines.length === 1
      ? lines[0]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : lines;
  if (parts.length === 1) return { address: parts[0] };

  const tail = parts[parts.length - 1];
  const street = parts.slice(0, -1).join(', ');
  const m = /^([A-Z]{0,2}[- ]?\d{2,5}(?:[ -]?\d{2,4})?)\s+(.+)$/.exec(tail);
  if (!m) return { address: [street, tail].filter(Boolean).join(', ') };
  return { address: street, postalCode: m[1].trim(), city: m[2].trim() };
}

interface ViesResponse {
  isValid?: boolean;
  userError?: string;
  name?: string;
  address?: string;
  vatNumber?: string;
}

export class ViesProvider implements CompanyRegistryProvider {
  readonly id = 'eu-vies';
  readonly label = 'VIES (EU VAT validation)';
  readonly countries = VIES_COUNTRIES;
  readonly schemes: readonly LookupScheme[] = ['VAT'];
  readonly identifierLabel = 'EU VAT number';
  readonly docsUrl = 'https://ec.europa.eu/taxation_customs/vies/';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.scheme !== 'VAT') return false;
    if (!this.countries.includes(query.countryCode.toUpperCase() as any)) return false;
    return stripVatPrefix(query.value, query.countryCode).length >= 4;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const ms = viesMemberState(query.countryCode);
    const number = stripVatPrefix(query.value, query.countryCode);
    const data = await fetchJson<ViesResponse>(`${VIES_BASE}/${ms}/vat/${encodeURIComponent(number)}`, {
      timeoutMs: this.timeoutMs,
    });
    if (!data) return null;

    // Saturated member state / malformed request — retryable, not "not found".
    if (data.userError && !['VALID', 'INVALID'].includes(data.userError)) {
      throw new ProviderLookupError('PROVIDER_ERROR', `VIES: ${data.userError}`);
    }
    if (data.isValid !== true) return null;

    const name = disclosed(data.name);
    const { address, postalCode, city } = parseViesAddress(disclosed(data.address));

    return {
      // Member states that do not disclose the name still confirm the number.
      name: name ?? `${ms}${number}`,
      legalName: name,
      VAT: `${ms}${number}`,
      address,
      postalCode,
      city,
      countryCode: query.countryCode.toUpperCase(),
      vatRegistered: true,
      status: 'ACTIVE',
    };
  }
}
