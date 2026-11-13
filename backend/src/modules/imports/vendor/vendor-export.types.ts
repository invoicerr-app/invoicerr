/**
 * Shapes shared by the vendor export reader. The three tools this covers publish
 * their exports under their own French column names, so the knowledge of "which column is which"
 * lives in `vendor-export-profiles.ts` as DATA: this file only names the canonical fields a profile
 * may map onto. The mapped row shapes arrive with the mapping itself.
 *
 * Nothing here talks to Prisma or Nest. `vendor-export-map.ts` is a pure function over a parsed
 * file, which is what makes "one test per tool and per export type" possible without a database.
 */
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
  | 'vatNumber'
  /** A national business registration number (SIREN, SIRET...), scheme left to the mapping. */
  | 'registrationNumber';

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
  | 'clientCountry'
  | 'status'
  | 'originalFileName';

/** A parsed file cell grid, as the import dialogs already build it. */
export interface VendorExportGrid {
  headers: string[];
  rows: string[][];
}

/** The file shapes a vendor exports. `zip` is an archive holding the `xlsx`, possibly with PDFs. */
export type VendorExportFileType = 'csv' | 'xlsx' | 'zip';

/**
 * One VAT amount column of an export that prints totals per rate instead of document lines. `rate`
 * is the percentage as the tool prints it, kept as a decimal string so `5.5` stays exact.
 */
export interface VendorVatAmountColumn {
  rate: string;
  headers: string[];
}

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
  /** File shapes the tool delivers this export in. Absent means CSV only. */
  fileTypes?: VendorExportFileType[];
  /** Per-rate VAT amount columns, for an export with no line detail. */
  vatAmountColumns?: VendorVatAmountColumn[];
  /**
   * Columns the tool prints that are known and deliberately not imported (running totals, bank
   * transactions, the tool's own ids). Listed so a real export's header row is fully accounted for.
   */
  ignoredColumns?: string[];
}
