/**
 * Structural field extraction from an UPLOADED inbound invoice — root TODO item 18. Ported from the
 * pre-refonte compliance engine's own inbound parser (`avant-refonte-documents:backend/src/
 * compliance/reception/inbound-document-parser.ts`), narrowed to the TWO syntaxes this branch's own
 * outbound formats actually produce (CII, UBL — `formats/cii-provider.ts`/`formats/ubl-provider.ts`)
 * plus Factur-X (the SAME CII, embedded in a PDF/A-3 — `formats/facturx-provider.ts`). FatturaPA/FA(3)
 * inbound parsing existed at the repère but is NOT ported here: this wave's own scope (root TODO item
 * 18) is the generic upload screen, not a second national-format reception path — see this module's
 * own `received-invoice.descriptor.ts` for the full list of what stays out of this wave.
 *
 * ## Never `fromXml` — the documented CII round-trip bug
 *
 * Per this repo's own operating memory: `@fin.cx/einvoice`/`@e-invoice-eu/core`'s `fromXml` has a
 * known round-trip bug on CII. This module NEVER calls it, on either syntax — every field below is
 * read with plain, namespace-agnostic REGEX tag extraction (`extractText`/`extractBlock`), exactly
 * the technique the repère's own parser used and for the same stated reason: CII's `rsm:`/`ram:`/
 * `udt:` namespace prefixes vary by producer, and a bare tag-name match sidesteps that variance
 * entirely rather than depending on any one XML library's prefix handling.
 *
 * Every one of this module's own extraction paths is proven, in `extraction.spec.ts`, against XML
 * this branch's OWN providers (`cii-provider.ts`/`ubl-provider.ts`/`facturx-provider.ts`) produce —
 * never a hand-written XML fixture — so a real drift in what our own outbound builders emit fails
 * this module's own test, not just a live round-trip with a third party.
 *
 * ## Line extraction — TODO_PRODUIT.md T5(a)
 *
 * BG-25 (invoice line) is repeated per line in both syntaxes — `ram:IncludedSupplyChainTradeLineItem`
 * (CII) / `cac:InvoiceLine` (UBL), verified by dumping this branch's OWN `cii-provider.ts`/
 * `ubl-provider.ts` output for a real two-line fixture (see `extraction.spec.ts`) rather than assumed
 * from the standard's own name tables. `extractAllBlocks` below is the same non-greedy,
 * namespace-agnostic technique as `extractBlock`, only repeated (global flag) to pick up every
 * sibling occurrence instead of the first — every per-line lookup below then re-scopes `extractText`/
 * `extractBlock` to ONE already-isolated line block, the same way the header-level fields above scope
 * to `SellerTradeParty`/`AccountingSupplierParty`, so a same-named element on a DIFFERENT line (or in
 * the header) is never mistaken for this one's.
 *
 * Four facts per line, read from BT-153/BT-129/BT-146/BT-152 (never BT-131, the line's OWN net total):
 *  - `description`  — CII `SpecifiedTradeProduct/Name`      · UBL `Item/Name`
 *  - `quantity`     — CII `SpecifiedLineTradeDelivery/BilledQuantity` · UBL `InvoicedQuantity`
 *  - `unitPrice`    — CII `SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount`
 *                      · UBL `Price/PriceAmount`
 *  - `vatRate`      — CII `SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent`
 *                      · UBL `Item/ClassifiedTaxCategory/Percent`
 *
 * `unitPrice`+`quantity`, never the line's own net/gross total: this is what lets
 * `received-invoice.descriptor.ts`'s own `lines` field reuse `totals/compute-totals.ts` UNCHANGED
 * (the exact same "money subfield × number subfield" convention `invoice.descriptor.ts`'s own lines
 * already use) — reading BT-131 directly instead would hand that engine an already-multiplied amount
 * it would multiply AGAIN by quantity, silently wrong the moment quantity isn't 1. A THIRD PARTY's
 * line-level allowance/charge (which this extraction does not read at all) can still make
 * quantity×unitPrice diverge from that supplier's own stated line net — exactly the kind of honest
 * divergence `received-invoices/line-totals-check.ts`'s own warning exists to surface, never hide.
 *
 * `vatRate` is kept as the RAW TEXT (e.g. "20"), not re-parsed to a number and back: it lands in
 * `data.lines[i].vatRate`, a 'select' field kind (field-kinds.ts) that requires a STRING value — the
 * exact same convention `invoice.descriptor.ts`'s own line fixture already uses (`vatRate: '20'`).
 * An unparseable rate is passed through as-is rather than dropped: `compute-totals.ts`'s own
 * `extractVatRate` already turns a non-numeric 'select' value into its existing "no usable VAT rate —
 * counted in net only" warning — reused, not re-implemented, here.
 */
import { PDFDocument, PDFName, PDFStream } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decodePDFRawStream } = require('pdf-lib/cjs/core');

/** One BG-25 line, as read off a structured deposit — see this file's own header, "Line extraction",
 *  for the exact CII/UBL path behind each key. Every key optional, same discipline as
 *  `ExtractedInvoiceFields` itself: a line missing one fact (e.g. no VAT rate at all) is still a real
 *  line, not a reason to drop it. */
export interface ExtractedInvoiceLine {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  /** RAW text (e.g. "20"), not a parsed number — see this file's own header for why. */
  vatRate?: string;
}

export interface ExtractedInvoiceFields {
  supplierNumber?: string;
  issueDate?: string; // "YYYY-MM-DD"
  supplier?: string;
  currency?: string;
  netAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
  /** Absent (never `[]`) when no BG-25 line block was found at all — same "omit, don't emit an empty
   *  collection" convention every other optional key here already follows. */
  lines?: ExtractedInvoiceLine[];
}

export type RecognizedSyntax = 'CII' | 'UBL' | 'FACTURX_CII' | null;

export interface ExtractionResult {
  /** null when nothing recognizable was found at all (a plain scanned PDF, an unknown XML dialect,
   *  or a file that failed to parse as either) — never thrown: see this module's own header on why a
   *  document with no extractable field is still a valid, honest outcome for this type. */
  syntax: RecognizedSyntax;
  fields: ExtractedInvoiceFields;
}

const EMPTY_RESULT: ExtractionResult = { syntax: null, fields: {} };

// ---------------------------------------------------------------------------
// Namespace-agnostic XML tag extraction — see this file's own header.
// ---------------------------------------------------------------------------

/** The text content of the FIRST occurrence of a tag (any namespace prefix). Handles `<Tag>text
 *  </Tag>`, `<ns:Tag>text</ns:Tag>`, `<Tag attr="…">text</Tag>` — not CDATA/mixed content, which
 *  none of the atomic fields this module reads ever use in our own or any real EN 16931 producer's
 *  output. */
function extractText(xml: string, ...tagNames: string[]): string | undefined {
  for (const tag of tagNames) {
    const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}(?:\\s[^>]*)?>((?:(?!<)[\\s\\S])*)<\\/(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}>`,
      'i',
    );
    const m = xml.match(re);
    const text = m?.[1]?.trim();
    if (text) return text;
  }
  return undefined;
}

/** The full XML block (opening tag through closing tag) for a given local name — scopes a later
 *  `extractText` lookup to a sub-element (e.g. `SellerTradeParty`) so a same-named tag elsewhere in
 *  the document (an `<ID>` inside a DIFFERENT party block) is never mistaken for the one wanted. */
function extractBlock(xml: string, tagName: string): string | undefined {
  const esc = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(<(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}(?:\\s[^>]*)?>)[\\s\\S]*?(<\\/(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}>)`,
    'i',
  );
  const m = xml.match(re);
  return m ? m[0] : undefined;
}

/** Every occurrence of a tag (any namespace prefix), each returned as its own full block (opening
 *  tag through closing tag) — the plural, GLOBAL sibling of `extractBlock` above, for a repeated
 *  element (BG-25's own line) rather than a unique one. Same non-greedy technique, so a line block
 *  never swallows into the next sibling's own content. */
function extractAllBlocks(xml: string, tagName: string): string[] {
  const esc = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}>`,
    'gi',
  );
  return xml.match(re) ?? [];
}

function toFloat(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isNaN(n) ? undefined : n;
}

/** CII dates are `YYYYMMDD` (format="102") — normalised to ISO; passed through unchanged otherwise
 *  (defensive: no real producer this module has seen emits anything else for this element). */
function normaliseCiiDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return t;
}

/**
 * EN 16931 CII (Cross Industry Invoice) — the exact element names `formats/cii-provider.ts` (via
 * `@e-invoice-eu/core`) is proven, in `providers.spec.ts`, to emit: `ExchangedDocument/ID` (the
 * invoice number), `ExchangedDocument/IssueDateTime/udt:DateTimeString` (format="102"),
 * `SellerTradeParty/Name`, `InvoiceCurrencyCode`, and
 * `SpecifiedTradeSettlementHeaderMonetarySummation`'s own `LineTotalAmount`/`TaxBasisTotalAmount`
 * (net), `TaxTotalAmount` (VAT), `GrandTotalAmount` (gross).
 */
function parseCii(xml: string): ExtractedInvoiceFields {
  const exchBlock = extractBlock(xml, 'ExchangedDocument');
  const supplierNumber = exchBlock ? extractText(exchBlock, 'ID') : undefined;
  const issueDate = normaliseCiiDate(exchBlock ? extractText(exchBlock, 'DateTimeString') : undefined);

  const sellerBlock = extractBlock(xml, 'SellerTradeParty');
  const supplier = sellerBlock ? extractText(sellerBlock, 'Name') : undefined;

  const currency = extractText(xml, 'InvoiceCurrencyCode');

  const summBlock = extractBlock(xml, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const netAmount = toFloat(
    summBlock
      ? (extractText(summBlock, 'LineTotalAmount') ?? extractText(summBlock, 'TaxBasisTotalAmount'))
      : undefined,
  );
  const vatAmount = toFloat(summBlock ? extractText(summBlock, 'TaxTotalAmount') : undefined);
  const grossAmount = toFloat(summBlock ? extractText(summBlock, 'GrandTotalAmount') : undefined);
  const lines = parseCiiLines(xml);

  return {
    supplierNumber,
    issueDate,
    supplier,
    currency,
    netAmount,
    vatAmount,
    grossAmount,
    ...(lines.length > 0 ? { lines } : {}),
  };
}

/** BG-25, CII side — see this file's own header, "Line extraction", for the exact element map. */
function parseCiiLines(xml: string): ExtractedInvoiceLine[] {
  return extractAllBlocks(xml, 'IncludedSupplyChainTradeLineItem').map((block) => {
    const productBlock = extractBlock(block, 'SpecifiedTradeProduct');
    const description = productBlock ? extractText(productBlock, 'Name') : undefined;

    const quantity = toFloat(extractText(block, 'BilledQuantity'));

    const priceBlock = extractBlock(block, 'NetPriceProductTradePrice');
    const unitPrice = toFloat(priceBlock ? extractText(priceBlock, 'ChargeAmount') : undefined);

    const taxBlock = extractBlock(block, 'ApplicableTradeTax');
    const vatRate = taxBlock ? extractText(taxBlock, 'RateApplicablePercent') : undefined;

    return { description, quantity, unitPrice, vatRate };
  });
}

/**
 * UBL 2.1 (EN16931_UBL) — the exact element names `formats/ubl-provider.ts` is proven to emit: the
 * document's own top-level `cbc:ID` (first occurrence in the document — always the header ID, since
 * every producer this module targets emits it before any nested party/line `ID`), `cbc:IssueDate`
 * (already ISO, no normalisation needed), `AccountingSupplierParty`'s own `cbc:RegistrationName`,
 * `cbc:DocumentCurrencyCode`, and `LegalMonetaryTotal`'s own `TaxExclusiveAmount` (net),
 * `TaxInclusiveAmount`/`PayableAmount` (gross), plus `TaxTotal/TaxAmount` (VAT).
 */
function parseUbl(xml: string): ExtractedInvoiceFields {
  const supplierNumber = extractText(xml, 'ID');
  const issueDate = extractText(xml, 'IssueDate');
  const currency = extractText(xml, 'DocumentCurrencyCode');

  const supplierBlock = extractBlock(xml, 'AccountingSupplierParty');
  const supplier = supplierBlock
    ? (extractText(supplierBlock, 'Name') ?? extractText(supplierBlock, 'RegistrationName'))
    : undefined;

  const legalBlock = extractBlock(xml, 'LegalMonetaryTotal');
  const netAmount = toFloat(legalBlock ? extractText(legalBlock, 'TaxExclusiveAmount') : undefined);
  const grossAmount = toFloat(
    legalBlock
      ? (extractText(legalBlock, 'PayableAmount') ?? extractText(legalBlock, 'TaxInclusiveAmount'))
      : undefined,
  );

  const taxBlock = extractBlock(xml, 'TaxTotal');
  const vatAmount = toFloat(taxBlock ? extractText(taxBlock, 'TaxAmount') : undefined);
  const lines = parseUblLines(xml);

  return {
    supplierNumber,
    issueDate,
    supplier,
    currency,
    netAmount,
    vatAmount,
    grossAmount,
    ...(lines.length > 0 ? { lines } : {}),
  };
}

/** BG-25, UBL side — see this file's own header, "Line extraction", for the exact element map. */
function parseUblLines(xml: string): ExtractedInvoiceLine[] {
  return extractAllBlocks(xml, 'InvoiceLine').map((block) => {
    const itemBlock = extractBlock(block, 'Item');
    const description = itemBlock ? extractText(itemBlock, 'Name') : undefined;

    const quantity = toFloat(extractText(block, 'InvoicedQuantity'));

    const priceBlock = extractBlock(block, 'Price');
    const unitPrice = toFloat(priceBlock ? extractText(priceBlock, 'PriceAmount') : undefined);

    const taxCategoryBlock = itemBlock ? extractBlock(itemBlock, 'ClassifiedTaxCategory') : undefined;
    const vatRate = taxCategoryBlock ? extractText(taxCategoryBlock, 'Percent') : undefined;

    return { description, quantity, unitPrice, vatRate };
  });
}

/** Best-effort syntax sniff — same signatures the repère's own `detectSyntax` used for these two
 *  syntaxes, narrowed to what this module actually parses. */
function detectXmlSyntax(raw: string): 'CII' | 'UBL' | null {
  const trimmed = raw.trimStart();
  if (
    trimmed.includes('CrossIndustryInvoice') ||
    trimmed.includes('urn:un:unece:uncefact:data:standard:CrossIndustryInvoice')
  )
    return 'CII';
  if (
    trimmed.includes('urn:oasis:names:specification:ubl') ||
    trimmed.includes('<Invoice') ||
    trimmed.includes('AccountingSupplierParty')
  )
    return 'UBL';
  return null;
}

/** Parses a raw XML string (already known to be XML — the caller decides that from the upload's own
 *  mime/filename, or from having just unwrapped it out of a PDF) into fields, auto-detecting CII vs
 *  UBL. Returns `EMPTY_RESULT`'s own shape (never throws) for an unrecognized XML dialect. */
function extractFromXmlString(xml: string): ExtractionResult {
  const syntax = detectXmlSyntax(xml);
  if (syntax === 'CII') return { syntax: 'CII', fields: parseCii(xml) };
  if (syntax === 'UBL') return { syntax: 'UBL', fields: parseUbl(xml) };
  return EMPTY_RESULT;
}

/**
 * Factur-X: EN 16931 CII embedded as a `/Type /EmbeddedFile` stream inside a PDF/A-3 — the exact
 * mechanism `formats/facturx-provider.ts` (via `@e-invoice-eu/core`'s `pdfDoc.attach()`) produces,
 * and the exact extraction technique `formats/facturx-provider.spec.ts#extractEmbeddedCii` already
 * proved works against OUR OWN generated Factur-X output: `pdf-lib` has no PUBLIC "read attachments"
 * API, so this reaches `decodePDFRawStream` (its own internal stream-decoding primitive) through the
 * package's `cjs/core` entry point, the same way that spec and `@e-invoice-eu/core` itself do
 * internally. Returns `undefined` (never throws) for a PDF with no embedded file at all — the
 * ordinary "plain scanned PDF" case this whole type exists to still accept.
 */
async function extractEmbeddedXmlFromPdf(bytes: Uint8Array): Promise<string | undefined> {
  let loaded: PDFDocument;
  try {
    loaded = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return undefined; // Not a parseable PDF at all — still an honest "nothing extractable" outcome.
  }
  for (const [, obj] of loaded.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    const type = obj.dict.get(PDFName.of('Type'));
    if (type?.toString() !== '/EmbeddedFile') continue;
    try {
      const decoded: Uint8Array = decodePDFRawStream(obj).decode();
      return Buffer.from(decoded).toString('utf-8');
    } catch {}
  }
  return undefined;
}

/**
 * The single entry point `received-invoices.service.ts` calls. `mime`/`fileName` decide the
 * STRATEGY (never trusted alone for the RESULT — a `.xml` extension whose bytes are not actually XML
 * still degrades to `EMPTY_RESULT` rather than throwing):
 *  - XML (mime `application/xml`/`text/xml`, or a `.xml` filename): parsed as CII or UBL directly.
 *  - PDF (mime `application/pdf`, or a `.pdf` filename): Factur-X extraction attempted first
 *    (embedded CII); a plain PDF with nothing embedded yields `EMPTY_RESULT` — never a refusal (see
 *    received-invoice.descriptor.ts's own header: a scanned paper invoice is the base case).
 *  - anything else: `EMPTY_RESULT` — an unrecognized file is still accepted (the caller attaches it
 *    regardless), just with nothing to pre-fill.
 */
export async function extractReceivedInvoiceFields(
  bytes: Uint8Array,
  mime: string,
  fileName: string,
): Promise<ExtractionResult> {
  const looksLikeXml = mime === 'application/xml' || mime === 'text/xml' || /\.xml$/i.test(fileName);
  const looksLikePdf = mime === 'application/pdf' || /\.pdf$/i.test(fileName);

  if (looksLikeXml) {
    const xml = Buffer.from(bytes).toString('utf-8');
    return extractFromXmlString(xml);
  }

  if (looksLikePdf) {
    const embedded = await extractEmbeddedXmlFromPdf(bytes);
    if (embedded === undefined) return EMPTY_RESULT;
    const result = extractFromXmlString(embedded);
    if (result.syntax === 'CII') return { syntax: 'FACTURX_CII', fields: result.fields };
    return result; // A Factur-X-shaped PDF embedding UBL instead would be non-standard, but degrade honestly.
  }

  return EMPTY_RESULT;
}
