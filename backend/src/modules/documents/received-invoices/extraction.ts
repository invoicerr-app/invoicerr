/**
 * Structural field extraction from an UPLOADED inbound invoice. Ported from the
 * pre-refonte compliance engine's own inbound parser (`avant-refonte-documents:backend/src/
 * compliance/reception/inbound-document-parser.ts`), narrowed to the TWO syntaxes this branch's own
 * outbound formats actually produce (CII, UBL — `formats/cii-provider.ts`/`formats/ubl-provider.ts`)
 * plus Factur-X (the SAME CII, embedded in a PDF/A-3 — `formats/facturx-provider.ts`). FatturaPA/FA(3)
 * inbound parsing existed in the removed compliance engine but is NOT ported here: the scope is the
 * generic upload screen, not a second national-format reception path — see this module's
 * own `received-invoice.descriptor.ts` for the full list of what stays out of scope.
 *
 * ## Never `fromXml` — the documented CII round-trip bug
 *
 * Per this repo's own operating memory: `@fin.cx/einvoice`/`@e-invoice-eu/core`'s `fromXml` has a
 * known round-trip bug on CII. This module NEVER calls it, on either syntax.
 *
 * ## DOM parsing, not hand-rolled regex — the tag lookup itself
 *
 * Every field below used to be read with plain, namespace-agnostic REGEX tag extraction. That broke
 * two ways on a THIRD PARTY's own XML (a PDP, an email attachment, a raw upload — never our own
 * output on this path):
 *  - `&amp;`/`&#233;`/etc. were never decoded, so a supplier whose name legitimately contains `&`,
 *    `<`, `'` or `"` (very ordinary in FR/IT/PL business names — "Dupont & Associés") came back
 *    literally as `Dupont &amp; Associés`, which `supplier-reconciliation.ts`'s exact-match lookup
 *    then NEVER matched against the same supplier's `Client.name` (which never went through this
 *    module's own escaping at all).
 *  - `extractAllBlocks`'s global, non-greedy `[\s\S]*?` re-scans the remaining document from EVERY
 *    candidate opening tag until it finds (or fails to find) a matching close tag. A deposit rich in
 *    opening tags that never close (a genuinely malformed document, or one deliberately built to be
 *    one) turns that into quadratic work over the whole byte count — a few MB is enough to visibly
 *    stall the event loop this runs on (a `bytes.length` check alone does not catch it: the document
 *    does not need to be huge, only richly, adversarially unclosed).
 *
 * Both are fixed by using a REAL XML parser instead: `@xmldom/xmldom`'s `DOMParser`, the exact same
 * already-whitelisted dependency `formats/structural-check.ts` uses for the identical "parse
 * third-party-shaped XML defensively" job (see that file's own header) — no new npm dependency, and
 * the same "collect fatal AND non-fatal parse errors, treat either as malformed" discipline reused
 * verbatim (`parseXmlDocument` below). `@xmldom/xmldom` never resolves an external entity or a DTD's
 * own `SYSTEM`/`PUBLIC` subset at all (verified against the installed `sax.js`: its `entityMap` for
 * an `application/xml` parse is the five XML-predefined entities ONLY — `amp`/`apos`/`gt`/`lt`/
 * `quot` — plus numeric character references, `&#233;`/`&#xE9;`, decoded by
 * `String.fromCharCode`; anything else, including a document's own custom or external `<!ENTITY>`,
 * is reported through `onError` as a plain "entity not found" and left untouched, never fetched) —
 * so there is no separate flag to disable external entities/DTD resolution here: the library is
 * structurally incapable of it, the same reasoning that already let `structural-check.ts` adopt it
 * with no extra hardening. A malformed document (unclosed tags, a bad entity reference) is treated as
 * `EMPTY_RESULT` — same "never throws, never blocks" contract this module has always held — rather
 * than degrading to a partial, unpredictable read.
 *
 * `MAX_XML_INPUT_BYTES` below is a SEPARATE, defense-in-depth bound checked before a single byte
 * reaches the parser: even a real, well-formed parser still has to walk every byte at least once, so
 * an upload with no plausible reason to be that large (no real EN 16931 invoice is) is refused
 * up front, named, rather than silently spending CPU proving it.
 *
 * Every one of this module's own extraction paths is proven, in `extraction.spec.ts`, against XML
 * this branch's OWN providers (`cii-provider.ts`/`ubl-provider.ts`/`facturx-provider.ts`) produce —
 * never a hand-written XML fixture — so a real drift in what our own outbound builders emit fails
 * this module's own test, not just a live round-trip with a third party.
 *
 * ## Line extraction
 *
 * BG-25 (invoice line) is repeated per line in both syntaxes — `ram:IncludedSupplyChainTradeLineItem`
 * (CII) / `cac:InvoiceLine` (UBL), verified by dumping this branch's OWN `cii-provider.ts`/
 * `ubl-provider.ts` output for a real two-line fixture (see `extraction.spec.ts`) rather than assumed
 * from the standard's own name tables. `collectByLocalName` below walks the parsed tree in document
 * order, namespace-agnostic (matching on `Element.localName` only — see `firstByLocalName`'s own
 * comment), the DOM equivalent of the old `extractBlock`/`extractAllBlocks` pair: every per-line
 * lookup below re-scopes its own search to ONE already-isolated line `Element`, the same way the
 * header-level fields above scope to `SellerTradeParty`/`AccountingSupplierParty`, so a same-named
 * element on a DIFFERENT line (or in the header) is never mistaken for this one's.
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
 *
 * ## Supplier VAT extraction
 *
 * BT-31 (seller VAT identifier), read one level deeper than `supplier` (the name) already scopes:
 *  - CII: `SellerTradeParty/SpecifiedTaxRegistration/ID` (`schemeID="VA"` — the attribute itself is
 *    never checked, since lookups below match by tag local name only, same discipline as every other
 *    field here: a producer that always sets `schemeID="VA"` for THIS element, per the standard, is
 *    not a fact worth re-verifying by attribute matching).
 *  - UBL: `AccountingSupplierParty/.../PartyTaxScheme/CompanyID` — scoped to the `PartyTaxScheme`
 *    block specifically, never a bare lookup straight on the supplier block: `PartyLegalEntity`
 *    (sibling block, same party) ALSO carries its own `CompanyID` (the seller's registration/SIRET —
 *    see `build-semantic-invoice.ts`), and reading unscoped would risk picking that one up instead the
 *    moment a producer emits `PartyLegalEntity` before `PartyTaxScheme` (both extraction and dump both
 *    verified against `cii-provider.ts`/`ubl-provider.ts`'s own real output, never assumed).
 *
 * Consumed by `received-invoices/supplier-reconciliation.ts` — never validated, formatted, or
 * otherwise interpreted here: this module stays a pure structural reader, exactly like every other
 * field it produces.
 */
import { DOMParser, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import { PDFDocument, PDFName, PDFStream } from 'pdf-lib';
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
  /** The supplier's OWN VAT identifier, read from the exact same
   *  `SellerTradeParty`/`AccountingSupplierParty` block `supplier` (the name) already scopes into, one
   *  level deeper: CII `SpecifiedTaxRegistration/ID` (`schemeID="VA"`) · UBL `PartyTaxScheme/
   *  CompanyID` — see this file's own header, "Supplier VAT extraction", for how these were verified
   *  against our own outbound providers' real output. Consumed by `received-invoices/
   *  supplier-reconciliation.ts` to auto-link a persistent Client — never used for anything else here
   *  (this module stays a pure reader, it never queries a client book itself). */
  supplierVatId?: string;
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
// DOM-based, namespace-agnostic XML tag lookup — see this file's own header.
// ---------------------------------------------------------------------------

/** No genuine EN 16931 CII/UBL invoice — our own output included — comes anywhere near this. A
 *  deposit over it is refused, named, before a single byte reaches the parser: defense in depth on
 *  top of switching away from the old backtracking-prone regex (see this file's own header) — a real
 *  parser still has to walk every byte at least once, so there is no reason to spend that walk on an
 *  upload with no plausible reason to be this large. */
const MAX_XML_INPUT_BYTES = 5 * 1024 * 1024;

type XmlDocument = ReturnType<DOMParser['parseFromString']>;

/** Parses `xml` defensively — `undefined` (never throws) for anything oversized, malformed, or
 *  without a root element, the same "collect fatal AND non-fatal errors, either means malformed"
 *  discipline `formats/structural-check.ts#validateStructural` already holds for the identical job of
 *  parsing third-party-shaped XML. Callers treat `undefined` exactly like the old regex path treated
 *  "nothing matched": an honest `EMPTY_RESULT`, never an exception. */
function parseXmlDocument(xml: string): XmlDocument | undefined {
  if (Buffer.byteLength(xml, 'utf-8') > MAX_XML_INPUT_BYTES) return undefined;

  const parseErrors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === 'error' || level === 'fatalError') parseErrors.push(message);
    },
  });
  let doc: XmlDocument | undefined;
  try {
    doc = parser.parseFromString(xml, 'application/xml');
  } catch (error) {
    parseErrors.push(error instanceof Error ? error.message : String(error));
  }
  if (parseErrors.length > 0 || !doc?.documentElement) return undefined;
  return doc;
}

/** `Element.localName` is set by `createElementNS` for every element `@xmldom/xmldom` builds
 *  (verified against the installed `dom.js`), prefixed or not — the `|| nodeName` fallback mirrors
 *  `structural-check.ts#validateStructural`'s own identical guard rather than assuming that always
 *  holds. */
function localNameOf(el: XmlElement): string {
  return el.localName || el.nodeName;
}

/** Every DESCENDANT element of `root` whose local name (any namespace prefix) is `tagName`, in
 *  document order — the DOM equivalent of the old `extractAllBlocks`'s global regex scan, without its
 *  quadratic-on-adversarial-input cost (see this file's own header). Never includes `root` itself:
 *  every call site below searches for a tag distinct from whatever block it is already scoped to. */
function collectByLocalName(root: XmlNode, tagName: string, out: XmlElement[] = []): XmlElement[] {
  for (const child of root.childNodes) {
    if (child.nodeType !== XmlNode.ELEMENT_NODE) continue;
    const el = child as unknown as XmlElement;
    if (localNameOf(el) === tagName) out.push(el);
    collectByLocalName(el, tagName, out);
  }
  return out;
}

/** The FIRST descendant matching `tagName`, in document order — the DOM equivalent of the old
 *  `extractBlock` (locating a block to scope further lookups into). */
function firstByLocalName(root: XmlNode, tagName: string): XmlElement | undefined {
  for (const child of root.childNodes) {
    if (child.nodeType !== XmlNode.ELEMENT_NODE) continue;
    const el = child as unknown as XmlElement;
    if (localNameOf(el) === tagName) return el;
    const nested = firstByLocalName(el, tagName);
    if (nested) return nested;
  }
  return undefined;
}

/** The trimmed text content of the FIRST descendant matching one of `tagNames` (first name that
 *  yields a non-empty result wins) — the DOM equivalent of the old `extractText`, now going through
 *  `Element.textContent`, which `@xmldom/xmldom` decodes entities into automatically (see this file's
 *  own header — this is the actual entity-decoding fix, not a separate post-processing step). */
function textOf(root: XmlNode, ...tagNames: string[]): string | undefined {
  for (const tag of tagNames) {
    const el = firstByLocalName(root, tag);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return undefined;
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
function parseCii(doc: XmlDocument): ExtractedInvoiceFields {
  // Non-null: `parseXmlDocument` never returns a document without one — see that function's own guard.
  const root = doc.documentElement as XmlElement;
  const exchBlock = firstByLocalName(root, 'ExchangedDocument');
  const supplierNumber = exchBlock ? textOf(exchBlock, 'ID') : undefined;
  const issueDate = normaliseCiiDate(exchBlock ? textOf(exchBlock, 'DateTimeString') : undefined);

  const sellerBlock = firstByLocalName(root, 'SellerTradeParty');
  const supplier = sellerBlock ? textOf(sellerBlock, 'Name') : undefined;
  const sellerTaxRegBlock = sellerBlock
    ? firstByLocalName(sellerBlock, 'SpecifiedTaxRegistration')
    : undefined;
  const supplierVatId = sellerTaxRegBlock ? textOf(sellerTaxRegBlock, 'ID') : undefined;

  const currency = textOf(root, 'InvoiceCurrencyCode');

  const summBlock = firstByLocalName(root, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const netAmount = toFloat(
    summBlock
      ? (textOf(summBlock, 'LineTotalAmount') ?? textOf(summBlock, 'TaxBasisTotalAmount'))
      : undefined,
  );
  const vatAmount = toFloat(summBlock ? textOf(summBlock, 'TaxTotalAmount') : undefined);
  const grossAmount = toFloat(summBlock ? textOf(summBlock, 'GrandTotalAmount') : undefined);
  const lines = parseCiiLines(root);

  return {
    supplierNumber,
    issueDate,
    supplier,
    supplierVatId,
    currency,
    netAmount,
    vatAmount,
    grossAmount,
    ...(lines.length > 0 ? { lines } : {}),
  };
}

/** BG-25, CII side — see this file's own header, "Line extraction", for the exact element map. */
function parseCiiLines(root: XmlElement): ExtractedInvoiceLine[] {
  return collectByLocalName(root, 'IncludedSupplyChainTradeLineItem').map((line) => {
    const productBlock = firstByLocalName(line, 'SpecifiedTradeProduct');
    const description = productBlock ? textOf(productBlock, 'Name') : undefined;

    const quantity = toFloat(textOf(line, 'BilledQuantity'));

    const priceBlock = firstByLocalName(line, 'NetPriceProductTradePrice');
    const unitPrice = toFloat(priceBlock ? textOf(priceBlock, 'ChargeAmount') : undefined);

    const taxBlock = firstByLocalName(line, 'ApplicableTradeTax');
    const vatRate = taxBlock ? textOf(taxBlock, 'RateApplicablePercent') : undefined;

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
function parseUbl(doc: XmlDocument): ExtractedInvoiceFields {
  // Non-null: `parseXmlDocument` never returns a document without one — see that function's own guard.
  const root = doc.documentElement as XmlElement;
  const supplierNumber = textOf(root, 'ID');
  const issueDate = textOf(root, 'IssueDate');
  const currency = textOf(root, 'DocumentCurrencyCode');

  const supplierBlock = firstByLocalName(root, 'AccountingSupplierParty');
  const supplier = supplierBlock
    ? (textOf(supplierBlock, 'Name') ?? textOf(supplierBlock, 'RegistrationName'))
    : undefined;
  // Scoped to `PartyTaxScheme` specifically, never a bare lookup on `supplierBlock` — see this file's
  // own header, "Supplier VAT extraction", on why `PartyLegalEntity`'s OWN `CompanyID` (a sibling
  // block, the seller's registration number) would otherwise be a real risk of being picked up instead.
  const supplierTaxSchemeBlock = supplierBlock
    ? firstByLocalName(supplierBlock, 'PartyTaxScheme')
    : undefined;
  const supplierVatId = supplierTaxSchemeBlock ? textOf(supplierTaxSchemeBlock, 'CompanyID') : undefined;

  const legalBlock = firstByLocalName(root, 'LegalMonetaryTotal');
  const netAmount = toFloat(legalBlock ? textOf(legalBlock, 'TaxExclusiveAmount') : undefined);
  const grossAmount = toFloat(
    legalBlock
      ? (textOf(legalBlock, 'PayableAmount') ?? textOf(legalBlock, 'TaxInclusiveAmount'))
      : undefined,
  );

  const taxBlock = firstByLocalName(root, 'TaxTotal');
  const vatAmount = toFloat(taxBlock ? textOf(taxBlock, 'TaxAmount') : undefined);
  const lines = parseUblLines(root);

  return {
    supplierNumber,
    issueDate,
    supplier,
    supplierVatId,
    currency,
    netAmount,
    vatAmount,
    grossAmount,
    ...(lines.length > 0 ? { lines } : {}),
  };
}

/** BG-25, UBL side — see this file's own header, "Line extraction", for the exact element map. */
function parseUblLines(root: XmlElement): ExtractedInvoiceLine[] {
  return collectByLocalName(root, 'InvoiceLine').map((line) => {
    const itemBlock = firstByLocalName(line, 'Item');
    const description = itemBlock ? textOf(itemBlock, 'Name') : undefined;

    const quantity = toFloat(textOf(line, 'InvoicedQuantity'));

    const priceBlock = firstByLocalName(line, 'Price');
    const unitPrice = toFloat(priceBlock ? textOf(priceBlock, 'PriceAmount') : undefined);

    const taxCategoryBlock = itemBlock ? firstByLocalName(itemBlock, 'ClassifiedTaxCategory') : undefined;
    const vatRate = taxCategoryBlock ? textOf(taxCategoryBlock, 'Percent') : undefined;

    return { description, quantity, unitPrice, vatRate };
  });
}

/** Best-effort syntax sniff — same signatures the removed compliance engine's own `detectSyntax` used
 *  for these two syntaxes, narrowed to what this module actually parses. Plain substring checks on
 *  the RAW text, deliberately NOT a regex over the whole document: this only ever has to decide WHICH
 *  parser to hand the document to, so it runs before (and independently of) `parseXmlDocument`, and a
 *  handful of `String.prototype.includes` calls carry none of the backtracking risk this file's own
 *  header describes for the old tag-lookup regexes. */
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
 *  UBL. Returns `EMPTY_RESULT`'s own shape (never throws) for an unrecognized XML dialect, an
 *  oversized deposit, or one that fails to parse at all — see this file's own header. */
function extractFromXmlString(xml: string): ExtractionResult {
  const syntax = detectXmlSyntax(xml);
  if (syntax === null) return EMPTY_RESULT;

  const doc = parseXmlDocument(xml);
  if (!doc) return EMPTY_RESULT;

  if (syntax === 'CII') return { syntax: 'CII', fields: parseCii(doc) };
  return { syntax: 'UBL', fields: parseUbl(doc) };
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
