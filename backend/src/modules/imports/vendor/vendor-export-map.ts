/**
 * The pure half of the vendor export reader: detect which tool produced a file from
 * its header row, then map each row onto the wire shape the EXISTING client import already accepts.
 * No Prisma, no Nest, no file I/O: the browser parses the bytes, this module only translates.
 *
 * A file whose headers do not match any profile is not an error here (`detectVendorExport` returns
 * undefined) because both import dialogs fall back to their generic template import. A file that
 * DOES match a profile but is missing one of its required columns is refused as a whole: guessing a
 * missing column would silently import the wrong values.
 */
import { ClientImportRow } from '../../clients/import/client-import.types';
import { vendorRowError } from './vendor-export-messages';
import { VENDOR_EXPORT_PROFILES } from './vendor-export-profiles';
import {
  VendorClientField,
  VendorExportGrid,
  VendorExportKind,
  VendorExportProfile,
  VendorInvoiceField,
  VendorMappedClientRow,
  VendorRowError,
} from './vendor-export.types';

export class VendorExportMappingError extends Error {}

/**
 * Drops a balanced `(...)` segment, keeping unbalanced text as it was. Done with `indexOf` rather
 * than `/\([^)]*\)/g`: on a header whose first run of many `(` never closes, that regex rescans the
 * rest of the string at every position, which is quadratic in the length of a user-provided file.
 */
function stripParentheticals(value: string): string {
  let result = '';
  let rest = value;
  for (;;) {
    const open = rest.indexOf('(');
    if (open === -1) return result + rest;
    const close = rest.indexOf(')', open + 1);
    if (close === -1) return result + rest;
    result += `${rest.slice(0, open)} `;
    rest = rest.slice(close + 1);
  }
}

/** Accent-, case- and punctuation-insensitive header key. `N° de facture` -> `n de facture`. */
export function normalizeHeader(value: string): string {
  return stripParentheticals(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** First profile whose signature is fully present in `headers`, in declaration order. */
export function detectVendorExport(
  kind: VendorExportKind,
  headers: string[],
  profiles: readonly VendorExportProfile[] = VENDOR_EXPORT_PROFILES,
): VendorExportProfile | undefined {
  const present = new Set(headers.map(normalizeHeader).filter(Boolean));
  return profiles.find(
    (profile) =>
      profile.kind === kind &&
      profile.signature.every((group) => group.some((alias) => present.has(normalizeHeader(alias)))),
  );
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * The document language the render layer actually handles, from the label the tool prints
 * (`Français`, `French`, `fr`). An unknown label is dropped rather than stored: `Client.language`
 * is rendered against a closed set of codes, so `Français` would silently fall back to English.
 */
const VENDOR_LANGUAGE_CODES: Record<string, string> = {
  francais: 'fr',
  french: 'fr',
  anglais: 'en',
  english: 'en',
  allemand: 'de',
  german: 'de',
  italien: 'it',
  italian: 'it',
  polonais: 'pl',
  polish: 'pl',
  portugais: 'pt',
  portuguese: 'pt',
};

export function vendorLanguageCode(value: string): string | undefined {
  const key = normalizeHeader(value);
  if (!key) return undefined;
  if (/^[a-z]{2}$/.test(key)) return key;
  return VENDOR_LANGUAGE_CODES[key];
}

/** Canonical field -> the column index of the first alias that exists in this file. */
function columnIndexes(profile: VendorExportProfile, headers: string[]): Map<string, number> {
  const normalizedHeaders = headers.map(normalizeHeader);
  const indexes = new Map<string, number>();
  for (const [canonical, aliases] of Object.entries(profile.columns)) {
    for (const alias of aliases ?? []) {
      const index = normalizedHeaders.indexOf(normalizeHeader(alias));
      if (index >= 0) {
        indexes.set(canonical, index);
        break;
      }
    }
  }
  return indexes;
}

function assertRequiredColumns(profile: VendorExportProfile, indexes: Map<string, number>): void {
  const missing = profile.required.filter((field) => !indexes.has(field));
  if (missing.length === 0) return;
  const names = missing.map((field) => `"${profile.columns[field]?.[0] ?? field}"`);
  throw new VendorExportMappingError(
    `This ${profile.label} file is missing the required column${missing.length > 1 ? 's' : ''} ` +
      `${names.join(', ')}. Keep the export's own columns: they can be left empty, never removed.`,
  );
}

function cell(
  cells: string[],
  indexes: Map<string, number>,
  field: VendorClientField | VendorInvoiceField,
): string {
  const index = indexes.get(field);
  return index === undefined ? '' : normalized(cells[index]);
}

/** The same two rules as the client import: email first, else name and country. */
function clientIdentityKey(
  row: ClientImportRow,
): { key: string; matchedOn: 'email' | 'name_country' } | undefined {
  const email = row.contactEmail?.trim().toLowerCase();
  if (email) return { key: `email:${email}`, matchedOn: 'email' };
  const name =
    row.type === 'INDIVIDUAL'
      ? `${row.contactFirstname ?? ''} ${row.contactLastname ?? ''}`.trim()
      : (row.name ?? '').trim();
  if (!name) return undefined;
  const country = (row.countryCode ?? row.country ?? '').trim().toLowerCase();
  return { key: `name:${name.toLowerCase()}\u0000${country}`, matchedOn: 'name_country' };
}

function mapClientRow(
  profile: VendorExportProfile,
  cells: string[],
  indexes: Map<string, number>,
  rowNumber: number,
): { row: ClientImportRow; errors: VendorRowError[] } {
  const errors: VendorRowError[] = [];
  const currency = cell(cells, indexes, 'currency').toUpperCase();
  const rawType = cell(cells, indexes, 'type').toUpperCase();
  const name = cell(cells, indexes, 'name');
  const firstname = cell(cells, indexes, 'contactFirstname');
  const lastname = cell(cells, indexes, 'contactLastname');
  // An explicit type column wins; otherwise a row with no company name but a last name is a person.
  const type =
    rawType === 'INDIVIDUAL' || rawType === 'PARTICULIER'
      ? 'INDIVIDUAL'
      : rawType === 'COMPANY' || rawType === 'SOCIETE' || rawType === 'ENTREPRISE'
        ? 'COMPANY'
        : !name && lastname
          ? 'INDIVIDUAL'
          : (profile.defaultClientType ?? 'COMPANY');

  if (type === 'INDIVIDUAL' && !firstname && !lastname) {
    errors.push(
      vendorRowError('clientNoName', {
        row: rowNumber,
        lastname: profile.columns.contactLastname?.[0] ?? 'contactLastname',
        firstname: profile.columns.contactFirstname?.[0] ?? 'contactFirstname',
      }),
    );
  }
  if (type === 'COMPANY' && !name) {
    errors.push(
      vendorRowError('companyNoName', { row: rowNumber, column: profile.columns.name?.[0] ?? 'name' }),
    );
  }

  const country = cell(cells, indexes, 'country');
  const explicitCode = cell(cells, indexes, 'countryCode').toUpperCase();
  const countryCode = explicitCode || (/^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : '');
  const vat = cell(cells, indexes, 'vatNumber');

  return {
    row: {
      rowNumber,
      type,
      // The client schema requires a kind and no vendor export carries one: the generic CSV
      // template defaults to BUSINESS too, so a government client is set by hand after import.
      kind: 'BUSINESS',
      name: type === 'INDIVIDUAL' ? '' : name,
      contactFirstname: firstname || undefined,
      contactLastname: lastname || undefined,
      contactEmail: cell(cells, indexes, 'contactEmail') || undefined,
      contactPhone: cell(cells, indexes, 'contactPhone') || undefined,
      address: cell(cells, indexes, 'address') || undefined,
      addressLine2: cell(cells, indexes, 'addressLine2') || undefined,
      postalCode: cell(cells, indexes, 'postalCode') || undefined,
      city: cell(cells, indexes, 'city') || undefined,
      state: cell(cells, indexes, 'state') || undefined,
      // Never drop the printed name when a code exists too: the client schema requires `country`,
      // and the server resolves either column to the same ISO code.
      country: country || undefined,
      countryCode: countryCode || undefined,
      currency: currency || undefined,
      language: vendorLanguageCode(cell(cells, indexes, 'language')) ?? null,
      identifiers: vat ? [{ scheme: 'VAT', value: vat }] : undefined,
    },
    errors,
  };
}

/**
 * Maps one parsed client export. `profile` comes from `detectVendorExport`; a caller that has not
 * detected one cannot use this function. Invoice profiles are read by their own mapping.
 */
export function mapVendorClientExport(
  profile: VendorExportProfile,
  grid: VendorExportGrid,
): VendorMappedClientRow[] {
  if (profile.kind !== 'clients') {
    throw new VendorExportMappingError(`${profile.label} is not a client export.`);
  }
  const indexes = columnIndexes(profile, grid.headers);
  assertRequiredColumns(profile, indexes);

  const mapped: VendorMappedClientRow[] = [];
  /** Only a row that will actually be created can claim an identity. */
  const seen = new Map<string, { rowNumber: number; matchedOn: 'email' | 'name_country' }>();

  grid.rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    if (cells.every((value) => normalized(value) === '')) return;

    if (cells.length < grid.headers.length) {
      mapped.push({
        rowNumber,
        status: 'rejected',
        // A truncated row cannot be mapped, but the preview needs the rowNumber to show where in
        // the file it stopped.
        row: { rowNumber },
        errors: [
          vendorRowError('truncatedRow', {
            row: rowNumber,
            headers: grid.headers.length,
            cells: cells.length,
          }),
        ],
      });
      return;
    }

    const { row, errors } = mapClientRow(profile, cells, indexes, rowNumber);
    if (errors.length > 0) {
      mapped.push({ rowNumber, status: 'rejected', row, errors });
      return;
    }
    const identity = clientIdentityKey(row);
    const earlier = identity ? seen.get(identity.key) : undefined;
    if (earlier) {
      mapped.push({
        rowNumber,
        status: 'duplicate',
        row,
        duplicateOfRow: earlier.rowNumber,
        duplicateMatchedOn: earlier.matchedOn,
      });
      return;
    }
    if (identity) seen.set(identity.key, { rowNumber, matchedOn: identity.matchedOn });
    mapped.push({ rowNumber, status: 'mapped', row });
  });

  return mapped;
}
