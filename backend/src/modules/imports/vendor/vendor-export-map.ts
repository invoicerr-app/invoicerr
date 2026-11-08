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
import { VENDOR_EXPORT_PROFILES } from './vendor-export-profiles';
import {
  VendorClientField,
  VendorExportGrid,
  VendorExportKind,
  VendorExportProfile,
  VendorInvoiceField,
  VendorMappedClientRow,
  VendorMappedInvoiceRow,
} from './vendor-export.types';

export class VendorExportMappingError extends Error {}

/** Accent-, case- and punctuation-insensitive header key. `N° de facture` -> `n de facture`. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim();
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

function clientIdentityKey(row: ClientImportRow): string | undefined {
  const email = row.contactEmail?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const name =
    row.type === 'INDIVIDUAL'
      ? `${row.contactFirstname ?? ''} ${row.contactLastname ?? ''}`.trim()
      : (row.name ?? '').trim();
  if (!name) return undefined;
  const country = (row.countryCode ?? row.country ?? '').trim().toLowerCase();
  return `name:${name.toLowerCase()}\u0000${country}`;
}

function mapClientRow(
  profile: VendorExportProfile,
  cells: string[],
  indexes: Map<string, number>,
  rowNumber: number,
): { row: ClientImportRow; errors: string[] } {
  const errors: string[] = [];
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
      `Row ${rowNumber}: the client has no first or last name in the "${profile.columns.contactLastname?.[0]}" / "${profile.columns.contactFirstname?.[0]}" columns.`,
    );
  }
  if (type === 'COMPANY' && !name) {
    errors.push(`Row ${rowNumber}: the company has no name in the "${profile.columns.name?.[0]}" column.`);
  }

  const country = cell(cells, indexes, 'country');
  const explicitCode = cell(cells, indexes, 'countryCode').toUpperCase();
  const countryCode = explicitCode || (/^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : '');
  const vat = cell(cells, indexes, 'vatNumber');

  return {
    row: {
      rowNumber,
      type,
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
      country: countryCode ? undefined : country || undefined,
      countryCode: countryCode || undefined,
      currency: currency || undefined,
      language: cell(cells, indexes, 'language') || null,
      identifiers: vat ? [{ scheme: 'VAT', value: vat }] : undefined,
    },
    errors,
  };
}

function mapInvoiceRow(
  cells: string[],
  indexes: Map<string, number>,
  rowNumber: number,
): { row: DocumentImportCsvRow; errors: string[] } {
  const errors: string[] = [];
  const originalNumber = cell(cells, indexes, 'originalNumber');
  const rawIssueDate = cell(cells, indexes, 'issueDate');
  const clientName = cell(cells, indexes, 'clientName');
  if (!originalNumber) errors.push(`Row ${rowNumber}: the invoice number is empty.`);
  if (!clientName) errors.push(`Row ${rowNumber}: the client name is empty.`);

  const issueDate = parseVendorDate(rawIssueDate);
  if (!issueDate) {
    errors.push(
      `Row ${rowNumber}: invalid date "${rawIssueDate}" (expected day/month/year or year-month-day).`,
    );
  }
  const rawDueDate = cell(cells, indexes, 'dueDate');
  const dueDate = rawDueDate ? parseVendorDate(rawDueDate) : issueDate;
  if (rawDueDate && !dueDate) {
    errors.push(
      `Row ${rowNumber}: invalid due date "${rawDueDate}" (expected day/month/year or year-month-day).`,
    );
  }

  const rawRate = cell(cells, indexes, 'lineVatRate');
  let vatRate = parseVendorVatRate(rawRate);
  if (rawRate && vatRate === undefined) {
    errors.push(`Row ${rowNumber}: invalid VAT value "${rawRate}".`);
  }

  const rawUnitPrice = cell(cells, indexes, 'lineUnitPrice');
  let net = parseVendorAmount(cell(cells, indexes, 'totalNet'));
  const vatAmount = parseVendorAmount(cell(cells, indexes, 'totalVat'));
  const gross = parseVendorAmount(cell(cells, indexes, 'totalGross'));
  const unitPrice = parseVendorAmount(rawUnitPrice);
  if (rawUnitPrice && unitPrice === undefined) {
    errors.push(`Row ${rowNumber}: invalid unit price "${rawUnitPrice}".`);
  }
  if (net === undefined && gross === undefined && unitPrice === undefined) {
    errors.push(`Row ${rowNumber}: the invoice has no readable amount.`);
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

  const lineAmount = unitPrice ?? net ?? 0;
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
      lineQuantity: cell(cells, indexes, 'lineQuantity') || '1',
      lineUnit: cell(cells, indexes, 'lineUnit') || 'unit',
      lineUnitPrice: String(Math.round(lineAmount * 100) / 100),
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
  const seenClients = new Map<string, number>();
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
          `Row ${rowNumber}: truncated row, the file has ${grid.headers.length} columns but this ` +
            `row has ${cells.length}.`,
        ],
      });
      return;
    }

    if (profile.kind === 'clients') {
      const { row, errors } = mapClientRow(profile, cells, indexes, rowNumber);
      const key = clientIdentityKey(row);
      const earlier = key ? seenClients.get(key) : undefined;
      if (earlier) {
        mapped.push({
          rowNumber,
          status: 'duplicate',
          row,
          duplicateOfRow: earlier,
        });
        return;
      }
      if (key) seenClients.set(key, rowNumber);
      mapped.push({ rowNumber, status: errors.length > 0 ? 'rejected' : 'mapped', row, errors });
      return;
    }

    const { row, errors } = mapInvoiceRow(cells, indexes, rowNumber);
    const key = row.originalNumber?.trim().toLowerCase();
    const earlier = key ? seenInvoices.get(key) : undefined;
    if (earlier) {
      mapped.push({ rowNumber, status: 'duplicate', row, duplicateOfRow: earlier });
      return;
    }
    if (key) seenInvoices.set(key, rowNumber);
    mapped.push({ rowNumber, status: errors.length > 0 ? 'rejected' : 'mapped', row, errors });
  });

  return mapped;
}
