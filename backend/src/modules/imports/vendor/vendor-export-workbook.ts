/**
 * Reads a vendor export delivered as an XLSX workbook, or as a ZIP archive holding one or more
 * workbooks (and possibly the invoice PDFs), into the same `VendorExportGrid` a parsed CSV gives.
 *
 * Only what an export needs is read: the first worksheet, shared and inline strings, numbers and
 * dates. Formulas are read from their cached value, never evaluated. A number is kept as the text
 * the file stores (`89960956400013` stays exact, it never goes through a float) and a cell styled
 * as a date becomes an ISO `YYYY-MM-DD`, so the profile's date parsing sees no locale.
 *
 * The bytes come from a user upload, so every size is capped before anything is inflated.
 */
import { DOMParser, Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';
import JSZip = require('jszip');

import { VendorExportGrid } from './vendor-export.types';

export class VendorExportFileError extends Error {}

/** One upload, compressed. Tiime archives with a year of PDFs stay well below this. */
export const MAX_VENDOR_UPLOAD_BYTES = 25 * 1024 * 1024;
/** One inflated XML part. A 1,000-row sheet is well under 2 MB. */
const MAX_XML_PART_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_WORKBOOKS_PER_ARCHIVE = 10;
/** A row or column reference past these is refused rather than allocated. */
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 200;

export interface VendorExportWorkbook {
  /** The workbook's path inside the archive, or `undefined` for a bare XLSX upload. */
  fileName?: string;
  grid: VendorExportGrid;
}

export interface VendorExportUpload {
  workbooks: VendorExportWorkbook[];
  /** PDF paths found next to the workbooks in an archive, for matching originals to invoices. */
  pdfFiles: string[];
}

/** Built-in SpreadsheetML number formats that display a date. */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  );
}

async function loadZip(bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new VendorExportFileError('This file is not a readable XLSX or ZIP archive.');
  }
}

/** Inflates one entry, stopping as soon as it passes `cap`: the stored size cannot be trusted. */
function readCapped(file: JSZip.JSZipObject, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const stream = file.nodeStream('nodebuffer') as NodeJS.ReadableStream & { destroy?: () => void };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      stream.removeAllListeners('data');
      stream.destroy?.();
      reject(new VendorExportFileError(message));
    };
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) return fail(`"${file.name}" is too large to be an export.`);
      chunks.push(chunk);
    });
    stream.on('error', (error: Error) => fail(`"${file.name}" could not be read: ${error.message}`));
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

function parseXml(xml: string, part: string): XmlDocument {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === 'error' || level === 'fatalError') errors.push(message);
    },
  });
  let doc: XmlDocument | undefined;
  try {
    doc = parser.parseFromString(xml, 'text/xml');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (errors.length > 0 || !doc?.documentElement) {
    throw new VendorExportFileError(`The workbook part "${part}" is not valid XML.`);
  }
  return doc;
}

function elements(parent: XmlDocument | XmlElement, localName: string): XmlElement[] {
  const list = parent.getElementsByTagNameNS('*', localName);
  const result: XmlElement[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list.item(i);
    if (item) result.push(item);
  }
  return result;
}

function children(parent: XmlElement, localName: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as XmlElement).localName === localName) result.push(node as XmlElement);
  }
  return result;
}

/** The text of every `<t>` under a string item, which also covers rich-text runs. */
function stringItemText(item: XmlElement): string {
  return elements(item, 't')
    .map((t) => t.textContent ?? '')
    .join('');
}

async function readPart(zip: JSZip, path: string): Promise<string | undefined> {
  const file = zip.file(path);
  return file ? (await readCapped(file, MAX_XML_PART_BYTES)).toString('utf8') : undefined;
}

/** Resolves a relationship target against the part that declares it (`xl/workbook.xml`). */
function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

async function firstSheetPath(zip: JSZip): Promise<string> {
  const workbookXml = await readPart(zip, 'xl/workbook.xml');
  if (!workbookXml) throw new VendorExportFileError('This XLSX file has no workbook.');
  const workbook = parseXml(workbookXml, 'xl/workbook.xml');
  const sheet = elements(workbook, 'sheet')[0];
  if (!sheet) throw new VendorExportFileError('This XLSX file has no worksheet.');
  const relId =
    sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ??
    sheet.getAttribute('r:id');
  const relsXml = await readPart(zip, 'xl/_rels/workbook.xml.rels');
  if (relId && relsXml) {
    const rel = elements(parseXml(relsXml, 'xl/_rels/workbook.xml.rels'), 'Relationship').find(
      (r) => r.getAttribute('Id') === relId,
    );
    const target = rel?.getAttribute('Target');
    if (target) return resolveTarget('xl/workbook.xml', target);
  }
  return 'xl/worksheets/sheet1.xml';
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await readPart(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];
  return elements(parseXml(xml, 'xl/sharedStrings.xml'), 'si').map(stringItemText);
}

/** Style index -> whether that cell format displays a date. */
async function dateStyles(zip: JSZip): Promise<boolean[]> {
  const xml = await readPart(zip, 'xl/styles.xml');
  if (!xml) return [];
  const styles = parseXml(xml, 'xl/styles.xml');
  const customDate = new Map<number, boolean>();
  for (const format of elements(styles, 'numFmt')) {
    // A date pattern once quoted literals and bracketed colours or locales are removed.
    const code = (format.getAttribute('formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    customDate.set(Number(format.getAttribute('numFmtId')), /[dy]/i.test(code) || /m{3,}/i.test(code));
  }
  const cellXfs = elements(styles, 'cellXfs')[0];
  if (!cellXfs) return [];
  return children(cellXfs, 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    return customDate.get(id) ?? BUILT_IN_DATE_FORMATS.has(id);
  });
}

async function uses1904Dates(zip: JSZip): Promise<boolean> {
  const xml = await readPart(zip, 'xl/workbook.xml');
  const pr = xml ? elements(parseXml(xml, 'xl/workbook.xml'), 'workbookPr')[0] : undefined;
  const value = pr?.getAttribute('date1904');
  return value === '1' || value === 'true';
}

/** A serial day count to `YYYY-MM-DD`; any time of day is dropped, as on an invoice date. */
function serialToIsoDate(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/** `167820.0` -> `167820`, without parsing through a float. */
function numberText(raw: string): string {
  const value = raw.trim();
  if (/e/i.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : value;
  }
  return value.replace(/^(-?\d+)\.0+$/, '$1').replace(/^(-?\d+\.\d*?)0+$/, '$1');
}

/** `AB12` -> zero-based column 27. */
function columnIndex(reference: string): number | undefined {
  const letters = /^([A-Z]+)\d*$/i.exec(reference)?.[1]?.toUpperCase();
  if (!letters) return undefined;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function cellText(cell: XmlElement, strings: string[], dates: boolean[], date1904: boolean): string {
  const type = cell.getAttribute('t') ?? 'n';
  if (type === 'inlineStr') {
    const is = children(cell, 'is')[0];
    return is ? stringItemText(is) : '';
  }
  const raw = children(cell, 'v')[0]?.textContent ?? '';
  switch (type) {
    case 's':
      return strings[Number(raw)] ?? '';
    case 'str':
      return raw;
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    case 'e':
      return '';
    default: {
      if (raw.trim() === '') return '';
      const style = Number(cell.getAttribute('s') ?? 0);
      const serial = Number(raw);
      if (dates[style] && Number.isFinite(serial)) return serialToIsoDate(serial, date1904);
      return numberText(raw);
    }
  }
}

/** Reads the first worksheet of an XLSX workbook already opened as a zip. */
async function readWorkbookZip(zip: JSZip): Promise<VendorExportGrid> {
  const sheetPath = await firstSheetPath(zip);
  const sheetXml = await readPart(zip, sheetPath);
  if (!sheetXml) throw new VendorExportFileError('This XLSX file has no worksheet.');
  const [strings, dates, date1904] = await Promise.all([
    sharedStrings(zip),
    dateStyles(zip),
    uses1904Dates(zip),
  ]);
  const sheet = parseXml(sheetXml, sheetPath);

  const rows: string[][] = [];
  let width = 0;
  elements(sheet, 'row').forEach((rowElement, position) => {
    const rowNumber = Number(rowElement.getAttribute('r') ?? position + 1);
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_ROWS) {
      throw new VendorExportFileError(`This sheet has more than ${MAX_ROWS} rows.`);
    }
    const cells: string[] = [];
    children(rowElement, 'c').forEach((cell, cellPosition) => {
      const column = columnIndex(cell.getAttribute('r') ?? '') ?? cellPosition;
      if (column >= MAX_COLUMNS) {
        throw new VendorExportFileError(`This sheet has more than ${MAX_COLUMNS} columns.`);
      }
      cells[column] = cellText(cell, strings, dates, date1904);
    });
    rows[rowNumber - 1] = cells;
    width = Math.max(width, cells.length);
  });

  // An empty cell is simply absent from the sheet: pad so every row has the header row's width.
  const grid = Array.from({ length: rows.length }, (_, index) =>
    Array.from({ length: width }, (_, column) => rows[index]?.[column] ?? ''),
  );
  const [headers = [], ...body] = grid;
  return { headers, rows: body };
}

function isWorkbookZip(zip: JSZip): boolean {
  return zip.file('xl/workbook.xml') !== null;
}

/** Hidden macOS metadata (`__MACOSX/`, `._name`) is not part of the export. */
function isMetadataEntry(path: string): boolean {
  return path.startsWith('__MACOSX/') || path.split('/').some((segment) => segment.startsWith('._'));
}

/**
 * Reads an uploaded export: an XLSX workbook, or a ZIP archive holding workbooks and PDFs. A CSV
 * never comes here; the browser parses it as before.
 */
export async function readVendorExportFile(bytes: Uint8Array): Promise<VendorExportUpload> {
  if (bytes.length > MAX_VENDOR_UPLOAD_BYTES) {
    throw new VendorExportFileError('This file is larger than an export can be imported at once.');
  }
  if (!isZip(bytes)) {
    throw new VendorExportFileError('This file is not an XLSX workbook or a ZIP archive.');
  }
  const zip = await loadZip(bytes);
  if (isWorkbookZip(zip)) {
    return { workbooks: [{ grid: await readWorkbookZip(zip) }], pdfFiles: [] };
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !isMetadataEntry(entry.name));
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new VendorExportFileError(`This archive holds more than ${MAX_ARCHIVE_ENTRIES} files.`);
  }
  const workbookEntries = entries.filter((entry) => /\.xlsx$/i.test(entry.name));
  if (workbookEntries.length === 0) {
    throw new VendorExportFileError('This archive holds no XLSX export.');
  }
  if (workbookEntries.length > MAX_WORKBOOKS_PER_ARCHIVE) {
    throw new VendorExportFileError(`This archive holds more than ${MAX_WORKBOOKS_PER_ARCHIVE} XLSX files.`);
  }

  const workbooks: VendorExportWorkbook[] = [];
  for (const entry of workbookEntries) {
    // A nested workbook is itself compressed, so its inflated size is capped like the upload.
    const inner = await readCapped(entry, MAX_VENDOR_UPLOAD_BYTES);
    const innerZip = await loadZip(inner);
    if (!isWorkbookZip(innerZip)) {
      throw new VendorExportFileError(`"${entry.name}" is not a readable XLSX workbook.`);
    }
    workbooks.push({ fileName: entry.name, grid: await readWorkbookZip(innerZip) });
  }

  const pdfFiles = entries.filter((entry) => /\.pdf$/i.test(entry.name)).map((entry) => entry.name);
  return { workbooks, pdfFiles };
}
