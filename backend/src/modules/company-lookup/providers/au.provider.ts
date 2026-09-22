/**
 * Australia — ABN Lookup (Australian Business Register).
 *
 * Endpoint : GET https://abr.business.gov.au/json/AbnDetails.aspx?abn={abn}&guid={guid}
 * Docs     : https://abr.business.gov.au/Documentation/Default
 * Credentials: ABR_GUID (free registration).
 *
 * The endpoint answers JSONP and reports every problem — including a bad GUID — with
 * HTTP 200 and a `Message` field, so the body has to be inspected, not the status.
 */
import { digits, fetchText, toDate } from '../http';
import {
  CompanyLookupCompany,
  CompanyLookupQuery,
  CompanyRegistryProvider,
  LookupScheme,
  ProviderLookupError,
} from '../types';

const ABR_URL = 'https://abr.business.gov.au/json/AbnDetails.aspx';

/** ABN: 11 digits, weighted mod-89 checksum after subtracting 1 from the first digit. */
export function isValidAbn(value: string): boolean {
  const clean = digits(value);
  if (clean.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = weights.reduce((acc, w, i) => acc + w * (parseInt(clean[i], 10) - (i === 0 ? 1 : 0)), 0);
  return sum % 89 === 0;
}

export function unwrapJsonp(body: string): any {
  const start = body.indexOf('(');
  const end = body.lastIndexOf(')');
  if (start < 0 || end <= start) {
    throw new ProviderLookupError('PROVIDER_ERROR', 'ABR returned a malformed payload');
  }
  try {
    return JSON.parse(body.slice(start + 1, end));
  } catch {
    throw new ProviderLookupError('PROVIDER_ERROR', 'ABR returned a malformed payload');
  }
}

export class AustraliaAbrProvider implements CompanyRegistryProvider {
  readonly id = 'au-abr';
  readonly label = 'ABN Lookup (Australian Business Register)';
  readonly countries = ['AU'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'ABN (11 digits)';
  readonly docsUrl = 'https://abr.business.gov.au/Documentation/Default';
  readonly credentialEnvVars = ['ABR_GUID'] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return !!process.env.ABR_GUID;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'AU') return false;
    return isValidAbn(query.value);
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const abn = digits(query.value);
    const body = await fetchText(
      `${ABR_URL}?abn=${abn}&callback=callback&guid=${encodeURIComponent(process.env.ABR_GUID as string)}`,
      { timeoutMs: this.timeoutMs, headers: { Accept: 'application/javascript' } },
    );
    if (!body) return null;

    const data = unwrapJsonp(body);
    if (data?.Message && !data.Abn) {
      if (/not recognised|not registered/i.test(data.Message)) {
        throw new ProviderLookupError('NOT_CONFIGURED', `ABR: ${data.Message}`);
      }
      return null;
    }
    if (!data?.Abn) return null;

    return {
      name: data.EntityName || data.BusinessName?.[0] || abn,
      legalName: data.EntityName || undefined,
      legalId: data.Abn,
      legalIdScheme: 'ABN',
      // GST registration is what makes the ABN usable as a tax number on an invoice.
      VAT: data.Gst ? data.Abn : undefined,
      postalCode: data.AddressPostcode || undefined,
      state: data.AddressState || undefined,
      country: 'Australia',
      countryCode: 'AU',
      foundedAt: toDate(data.AbnStatusEffectiveFrom),
      status: /active/i.test(data.AbnStatus ?? '') ? 'ACTIVE' : 'INACTIVE',
      vatRegistered: !!data.Gst,
    };
  }
}
