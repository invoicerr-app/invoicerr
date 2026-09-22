/**
 * Israel — רשם החברות (Registrar of Companies), published as a data.gov.il dataset.
 *
 * Endpoint : GET https://data.gov.il/api/3/action/datastore_search
 *            ?resource_id={COMPANIES_RESOURCE}&filters={"מספר חברה":510000011}&limit=1
 * Docs     : https://data.gov.il/dataset/ico_gis
 * Credentials: none.
 *
 * The dataset is the register itself (~730k rows), so the field names are Hebrew and
 * the address arrives split across columns. Israeli VAT (מספר עוסק) equals the company
 * number, so no separate VAT lookup is needed.
 */
import { digits, fetchJson } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const CKAN_URL = 'https://data.gov.il/api/3/action/datastore_search';
const COMPANIES_RESOURCE = 'f004176c-b85f-4542-8901-7b3176f9a054';

const FIELD = {
  number: 'מספר חברה',
  name: 'שם חברה',
  englishName: 'שם באנגלית',
  status: 'סטטוס חברה',
  incorporated: 'תאריך התאגדות',
  city: 'שם עיר',
  street: 'שם רחוב',
  houseNumber: 'מספר בית',
  postalCode: 'מיקוד',
} as const;

/** The register publishes dates as dd/mm/yyyy. */
function parseIsraeliDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return undefined;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export class IsraelRegistrarProvider implements CompanyRegistryProvider {
  readonly id = 'il-registrar';
  readonly label = 'רשם החברות (data.gov.il)';
  readonly countries = ['IL'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'מספר חברה (9 digits)';
  readonly docsUrl = 'https://data.gov.il/dataset/ico_gis';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'IL') return false;
    return digits(query.value).length === 9;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const number = digits(query.value);
    // CKAN wants the filter as a JSON object; the register stores the number as an integer.
    const filters = encodeURIComponent(JSON.stringify({ [FIELD.number]: Number(number) }));
    const data = await fetchJson<any>(
      `${CKAN_URL}?resource_id=${COMPANIES_RESOURCE}&limit=1&filters=${filters}`,
      { timeoutMs: this.timeoutMs },
    );
    const record = data?.result?.records?.[0];
    if (!record) return null;

    const englishName = String(record[FIELD.englishName] ?? '').trim();
    return {
      name: englishName || record[FIELD.name],
      legalName: record[FIELD.name],
      legalId: String(record[FIELD.number]),
      legalIdScheme: 'COMPANY_NUMBER',
      // In Israel the company number doubles as the VAT (עוסק) number.
      VAT: String(record[FIELD.number]),
      address: join(record[FIELD.street], record[FIELD.houseNumber]),
      postalCode: record[FIELD.postalCode] ? String(record[FIELD.postalCode]) : undefined,
      city: record[FIELD.city],
      country: 'ישראל',
      countryCode: 'IL',
      foundedAt: parseIsraeliDate(record[FIELD.incorporated]),
      status: String(record[FIELD.status] ?? '').includes('פעילה') ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
