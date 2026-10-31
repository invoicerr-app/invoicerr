/**
 * The downloadable CSV template, and the one source of truth for the import's column headers so the
 * template and the parser cannot drift.
 */
import { toCsvLine } from '@/utils/csv';

/** Template columns. `identifier:<SCHEME>` is open-ended; the two shown are illustrative. */
export const CLIENT_IMPORT_TEMPLATE_HEADERS = [
  'type',
  'kind',
  'isSupplier',
  'name',
  'contactFirstname',
  'contactLastname',
  'contactEmail',
  'contactPhone',
  'address',
  'addressLine2',
  'postalCode',
  'city',
  'state',
  'country',
  'countryCode',
  'currency',
  'language',
  'description',
  'foundedAt',
  'identifier:VAT',
  'identifier:LEGAL_ID',
] as const;

const EXAMPLE_ROW = [
  'COMPANY',
  'BUSINESS',
  'false',
  'Acme SARL',
  '',
  '',
  'billing@acme.example',
  '+33 1 23 45 67 89',
  '12 rue de la Paix',
  '',
  '75002',
  'Paris',
  '',
  'France',
  'FR',
  'EUR',
  'fr',
  '',
  '2010-05-14',
  'FR12345678901',
  '55210055400018',
];

export function buildClientImportTemplateCsv(): string {
  return [toCsvLine(CLIENT_IMPORT_TEMPLATE_HEADERS as unknown as string[]), toCsvLine(EXAMPLE_ROW)].join(
    '\r\n',
  );
}
