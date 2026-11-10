/**
 * The pure half of the vendor export reader (issue #759): detect which tool produced a file from
 * its header row, then map each row onto the wire shape the two EXISTING imports already accept.
 * No Prisma, no Nest, no file I/O: the browser parses the bytes, this module only translates.
 *
 * A file whose headers do not match any profile is not an error here (`detectVendorExport` returns
 * undefined) because both dialogs fall back to their generic template import. A file that DOES
 * match a profile but is missing one of its required columns is refused as a whole: guessing a
 * missing column would silently import the wrong values.
 */
import { ClientImportRow } from '../../clients/import/client-import.types';
import { DocumentImportCsvRow } from '../../documents/import/document-import-csv.types';
import { vendorRowError } from './vendor-export-messages';
import { VENDOR_EXPORT_PROFILES } from './vendor-export-profiles';
import {
  VendorClientField,
  VendorExportGrid,
  VendorExportKind,
  VendorExportProfile,
  VendorInvoiceField,
  VendorMappedClientRow,
  VendorMappedInvoiceRow,
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
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

/** First profile whose signature is fully present in `headers`, in declaration order. */
export function detectVendorExport(
  kind: VendorExportKind,
  headers: string[],
): VendorExportProfile | undefined {
  const present = new Set(headers.map(normalizeHeader).filter(Boolean));
  return VENDOR_EXPORT_PROFILES.find(
    (profile) =>
      profile.kind === kind &&
      profile.signature.every((group) => group.some((alias) => present.has(normalizeHeader(alias)))),
  );
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
  const names = missing.map((field) => {
    const aliases = profile.columns[field as VendorClientField & VendorInvoiceField] ?? [];
    return `"${aliases[0] ?? field}"`;
  });
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

/**
 * Money as the three tools print it: `1 234,56`, `1,234.56`, `-12.00`, `12 €`. Returns undefined
 * rather than a half-parsed number, so the caller can reject the row and name it.
 */
export function parseVendorAmount(value: string): number | undefined {
  let text = value
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/[€$£]/g, '')
    .replace(/%/g, '');
  if (!text) return undefined;
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    // Whichever separator comes last is the decimal one.
    text =
      text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
  } else if (hasComma) {
    text = text.replace(',', '.');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A VAT rate as a percentage: `20`, `20 %`, `0,2` (a fraction) -> 20. */
export function parseVendorVatRate(value: string): number | undefined {
  const parsed = parseVendorAmount(value);
  if (parsed === undefined) return undefined;
  if (parsed > 0 && parsed < 1) return Math.round(parsed * 10000) / 100;
  return parsed;
}

/**
 * Dates as the tools print them: ISO, or day-first (`15/03/2024`, `15-03-2024`, `15.03.2024`).
 * A month-first value such as `03/15/2024` is refused rather than reinterpreted: every one of
 * these three tools is French and prints day first, so accepting both would hide a real error.
 */
export function parseVendorDate(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    [, year, month, day] = iso.map(Number) as unknown as [string, number, number, number];
  } else {
    const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (!dayFirst) return undefined;
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    year = Number(dayFirst[3]);
    if (month > 12) return undefined;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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
  const rawName = cell(cells, indexes, 'name');
  const firstname = cell(cells, indexes, 'contactFirstname');
  const lastname = cell(cells, indexes, 'contactLastname');
  // Henrri leaves "Raison sociale" empty for a private individual; the name is then in "Nom".
  const type =
    rawType === 'INDIVIDUAL' || rawType === 'PARTICULIER'
      ? 'INDIVIDUAL'
      : rawType === 'COMPANY' || rawType === 'SOCIETE' || rawType === 'ENTREPRISE'
        ? 'COMPANY'
        : !rawName && lastname
          ? 'INDIVIDUAL'
          : (profile.defaultClientType ?? 'COMPANY');

  const name = rawName;
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
      vendorRowError('companyNoName', {
        row: rowNumber,
        column: profile.columns.name?.[0] ?? 'name',
      }),
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
 * Splits an invoice total into the single line the past-document CSV import accepts. A printed unit
 * price wins; without one the total is divided by the printed quantity, and when that division does
 * not recompose the total exactly (a rounded share, or a discount already baked into the total) the
 * line falls back to one unit carrying the total, so the imported invoice keeps the amount the
 * export states instead of a recomposed one.
 */
function lineFromTotals(
  unitPrice: number | undefined,
  quantity: number | undefined,
  net: number | undefined,
): { lineQuantity: string; lineAmount: number } {
  const total = net === undefined ? undefined : Math.round(net * 100) / 100;
  const units = quantity !== undefined && quantity > 0 ? quantity : undefined;
  let amount = unitPrice ?? total ?? 0;
  if (total !== undefined && units !== undefined) {
    if (unitPrice === undefined) amount = Math.round((total / units) * 100) / 100;
    const recomposed = Math.round(amount * units * 100) / 100;
    if (recomposed !== total) return { lineQuantity: '1', lineAmount: total };
    return { lineQuantity: String(units), lineAmount: Math.round(amount * 100) / 100 };
  }
  return {
    lineQuantity: units === undefined ? '1' : String(units),
    lineAmount: Math.round(amount * 100) / 100,
  };
}

function mapInvoiceRow(
  cells: string[],
  indexes: Map<string, number>,
  rowNumber: number,
): { row: DocumentImportCsvRow; errors: VendorRowError[] } {
  const errors: VendorRowError[] = [];
  const originalNumber = cell(cells, indexes, 'originalNumber');
  const rawIssueDate = cell(cells, indexes, 'issueDate');
  const clientName = cell(cells, indexes, 'clientName');
  if (!originalNumber) errors.push(vendorRowError('invoiceNumberEmpty', { row: rowNumber }));
  if (!clientName) errors.push(vendorRowError('clientNameEmpty', { row: rowNumber }));

  const issueDate = parseVendorDate(rawIssueDate);
  if (!issueDate) {
    errors.push(vendorRowError('invalidIssueDate', { row: rowNumber, value: rawIssueDate }));
  }
  const rawDueDate = cell(cells, indexes, 'dueDate');
  const dueDate = rawDueDate ? parseVendorDate(rawDueDate) : issueDate;
  if (rawDueDate && !dueDate) {
    errors.push(vendorRowError('invalidDueDate', { row: rowNumber, value: rawDueDate }));
  }

  const rawRate = cell(cells, indexes, 'lineVatRate');
  let vatRate = parseVendorVatRate(rawRate);
  if (rawRate && vatRate === undefined) {
    errors.push(vendorRowError('invalidVatRate', { row: rowNumber, value: rawRate }));
  }

  const rawUnitPrice = cell(cells, indexes, 'lineUnitPrice');
  let net = parseVendorAmount(cell(cells, indexes, 'totalNet'));
  const vatAmount = parseVendorAmount(cell(cells, indexes, 'totalVat'));
  const gross = parseVendorAmount(cell(cells, indexes, 'totalGross'));
  const unitPrice = parseVendorAmount(rawUnitPrice);
  if (rawUnitPrice && unitPrice === undefined) {
    errors.push(vendorRowError('invalidUnitPrice', { row: rowNumber, value: rawUnitPrice }));
  }
  if (net === undefined && gross === undefined && unitPrice === undefined) {
    errors.push(vendorRowError('noAmount', { row: rowNumber }));
  }
  if (vatRate === undefined && vatAmount !== undefined && net !== undefined && net !== 0) {
    vatRate = Math.round((vatAmount / net) * 10000) / 100;
  }
  if (vatRate === undefined && net !== undefined && gross !== undefined && net !== 0) {
    vatRate = Math.round(((gross - net) / net) * 10000) / 100;
  }
  if (net === undefined && gross !== undefined) {
    net = gross / (1 + (vatRate ?? 0) / 100);
  }

  const { lineQuantity, lineAmount } = lineFromTotals(
    unitPrice,
    parseVendorAmount(cell(cells, indexes, 'lineQuantity')),
    net,
  );
  return {
    row: {
      rowNumber,
      originalNumber,
      issueDate,
      dueDate,
      currency: cell(cells, indexes, 'currency').toUpperCase() || 'EUR',
      notes: cell(cells, indexes, 'notes') || undefined,
      clientName,
      clientReference: undefined,
      lineDescription: cell(cells, indexes, 'lineDescription') || `Imported invoice ${originalNumber}`,
      lineQuantity,
      lineUnit: cell(cells, indexes, 'lineUnit') || 'unit',
      lineUnitPrice: String(lineAmount),
      lineVatRate: String(vatRate ?? 0),
      originalFileName: cell(cells, indexes, 'originalFileName') || undefined,
      clientId: cell(cells, indexes, 'clientId') || undefined,
    },
    errors,
  };
}

/**
 * Maps one parsed file. `profile` comes from `detectVendorExport`; a caller that has not detected
 * one cannot use this function.
 */
export function mapVendorExport(
  profile: VendorExportProfile,
  grid: VendorExportGrid,
): VendorMappedClientRow[] | VendorMappedInvoiceRow[] {
  const indexes = columnIndexes(profile, grid.headers);
  assertRequiredColumns(profile, indexes);

  const mapped: VendorMappedClientRow[] | VendorMappedInvoiceRow[] = [];
  /** Only a row that will actually be created can claim an identity or a number. */
  const seenClients = new Map<string, { rowNumber: number; matchedOn: 'email' | 'name_country' }>();
  const seenInvoices = new Map<string, number>();

  grid.rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    if (cells.every((value) => normalized(value) === '')) return;

    if (cells.length < grid.headers.length) {
      mapped.push({
        rowNumber,
        status: 'rejected',
        // The row is still shaped: a truncated row cannot be mapped, but the preview needs the
        // rowNumber to show where in the file it stopped.
        row: { rowNumber } as ClientImportRow & DocumentImportCsvRow,
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

    if (profile.kind === 'clients') {
      const { row, errors } = mapClientRow(profile, cells, indexes, rowNumber);
      if (errors.length > 0) {
        mapped.push({ rowNumber, status: 'rejected', row, errors });
        return;
      }
      const identity = clientIdentityKey(row);
      const earlier = identity ? seenClients.get(identity.key) : undefined;
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
      if (identity) seenClients.set(identity.key, { rowNumber, matchedOn: identity.matchedOn });
      mapped.push({ rowNumber, status: 'mapped', row });
      return;
    }

    const { row, errors } = mapInvoiceRow(cells, indexes, rowNumber);
    if (errors.length > 0) {
      mapped.push({ rowNumber, status: 'rejected', row, errors });
      return;
    }
    const key = row.originalNumber?.trim().toLowerCase();
    const earlier = key ? seenInvoices.get(key) : undefined;
    if (earlier !== undefined) {
      mapped.push({ rowNumber, status: 'duplicate', row, duplicateOfRow: earlier });
      return;
    }
    if (key) seenInvoices.set(key, rowNumber);
    mapped.push({ rowNumber, status: 'mapped', row });
  });

  return mapped;
}
