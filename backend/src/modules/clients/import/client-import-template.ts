/**
 * The downloadable CSV template - the ONE source of truth for the import's column headers, so the
 * "download template" link and the parser's own expected headers can never drift apart. Columns are
 * exactly the fields a user can set through the client creation form (`EditClientsDto` minus the
 * server-owned `id`/`companyId`/`isActive`/timestamps), plus two illustrative `identifier:<SCHEME>`
 * columns - see `client-import.service.ts`'s own header for why identifiers are an open-ended
 * `identifier:<SCHEME>` prefix rather than a fixed column per scheme, and why `customFields` has no
 * column at all (out of scope for v1).
 */
import { toCsvLine } from '@/utils/csv';

/** The fixed columns, in the order the template ships them - mirrors `EditClientsDto`'s own field
 *  order. `identifier:VAT`/`identifier:LEGAL_ID` are ILLUSTRATIVE, not exhaustive: a row may carry
 *  any `identifier:<SCHEME>` column the target country's own catalog declares (DE's Leitweg-ID, IT's
 *  Codice Destinatario, …) - an unrecognised scheme is not an error, it is simply an identifier the
 *  target country's catalog has nothing to say about (the same "no pattern declared" case
 *  `validate-identifier-value.ts` already treats as passing). `LEGAL_ID`, not `SIRET`: France's own
 *  catalog (`country-identifiers/data/fr.json`) names its SIREN/SIRET scheme `LEGAL_ID` - an earlier
 *  version of this template used the human label instead of the actual scheme key, which meant the
 *  example row below carried an identifier no lookup would ever match its own required LEGAL_ID
 *  against, so the shipped example FAILED its own import (caught by the Cypress round-trip spec that
 *  uploads this exact file back). */
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
