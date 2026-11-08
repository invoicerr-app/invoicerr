/**
 * Shapes shared by the vendor export reader (issue #759). The three tools this covers publish
 * their exports under their own French column names, so the knowledge of "which column is which"
 * lives in `vendor-export-profiles.ts` as DATA: this file only names the canonical fields a profile
 * may map onto, and the wire result the two existing imports (clients, past documents) consume.
 *
 * Nothing here talks to Prisma or Nest. `vendor-export-map.ts` is a pure function over a parsed
 * file, which is what makes "one test per tool and per export type" possible without a database.
 */
import { ClientImportRow } from '../../clients/import/client-import.types';
import { DocumentImportCsvRow } from '../../documents/import/document-import-csv.types';

export type VendorId = 'abby' | 'henrri' | 'tiime';
export type VendorExportKind = 'clients' | 'invoices';

/**
 * The canonical client fields a vendor profile may declare. Mirrors the subset of
 * `ClientImportRow` that an export carries; custom fields stay out of scope, exactly like the
 * generic CSV import (see `client-import.service.ts`'s own header).
 */
export type VendorClientField =
  | 'type'
  | 'name'
  | 'contactFirstname'
  | 'contactLastname'
  | 'contactEmail'
  | 'contactPhone'
  | 'address'
  | 'addressLine2'
  | 'postalCode'
  | 'city'
  | 'state'
  | 'country'
  | 'countryCode'
  | 'currency'
  | 'language'
  | 'vatNumber';

/**
 * The canonical invoice fields a vendor profile may declare. A vendor export is one row per
 * document, so a profile at most feeds the existing single-line contract (see
 * `document-import-csv.types.ts`'s own header for why that is the shape, not a limitation of this
 * reader).
 */
export type VendorInvoiceField =
  | 'originalNumber'
  | 'issueDate'
  | 'dueDate'
  | 'currency'
  | 'clientName'
  | 'clientId'
  | 'notes'
  | 'lineDescription'
  | 'lineQuantity'
  | 'lineUnit'
  | 'lineUnitPrice'
  | 'lineVatRate'
  | 'totalNet'
  | 'totalVat'
  | 'totalGross'
  | 'originalFileName';

export interface VendorExportProfile {
  /** Stable id: `<vendor>-<kind>[-<variant>]`. */
  id: string;
  vendor: VendorId;
  vendorLabel: string;
  kind: VendorExportKind;
  /** English label shown in the preview, e.g. "Abby contacts export". */
  label: string;
  /**
   * Detection signature: every group must be satisfied by at least one header. A group lists
   * accepted spellings, already normalized by `normalizeHeader`. More specific profiles are
   * declared first; detection returns the first match.
   */
  signature: string[][];
  /** Canonical field -> accepted source headers (raw spelling; normalized at load time). */
  columns: Partial<Record<VendorClientField | VendorInvoiceField, string[]>>;
  /** Canonical fields that must have a matching header, or the file is refused as a whole. */
  required: (VendorClientField | VendorInvoiceField)[];
  /** Default party type when the export does not carry a type column. */
  defaultClientType?: 'COMPANY' | 'INDIVIDUAL';
  /** Date order the tool prints. `auto` accepts ISO and day-first dates, never month-first. */
  dateFormat?: 'auto' | 'iso' | 'day-first';
  /** A delimiter hint for the browser, when the tool's CSV is known to use it. */
  delimiterHint?: ';' | ',';
}

/** One row's fate after mapping: mapped rows are sent to the existing import preview/confirm. */
export type VendorRowStatus = 'mapped' | 'rejected' | 'duplicate';

export interface VendorMappedClientRow {
  rowNumber: number;
  status: VendorRowStatus;
  row: ClientImportRow;
  errors?: string[];
  duplicateOfRow?: number;
}

export interface VendorMappedInvoiceRow {
  rowNumber: number;
  status: VendorRowStatus;
  row: DocumentImportCsvRow;
  errors?: string[];
  duplicateOfRow?: number;
}

export interface VendorExportPreview {
  detected: true;
  vendor: VendorId;
  vendorLabel: string;
  kind: VendorExportKind;
  profileId: string;
  label: string;
  rows: VendorMappedClientRow[] | VendorMappedInvoiceRow[];
}

export interface VendorExportNotDetected {
  detected: false;
  kind: VendorExportKind;
  reason: string;
}

export type VendorExportResult = VendorExportPreview | VendorExportNotDetected;

/** A parsed file cell grid, as both import dialogs already build it. */
export interface VendorExportGrid {
  headers: string[];
  rows: string[][];
}

/**
 * A tool whose export exists but cannot be read as columns. Abby is the case this feature has to
 * name honestly: it exports invoices as a PDF archive only, so there is no row-shaped file to map.
 */
export interface UnsupportedVendorExport {
  vendor: VendorId;
  kind: VendorExportKind;
  reason: string;
  source: string;
}
