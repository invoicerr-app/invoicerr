/**
 * Inbound document parser — structural extraction of canonical fields from raw
 * supplier e-invoice payloads (CII, UBL, FatturaPA, FA_VAT).
 *
 * Design: pure functions, no I/O. Uses regex-based tag extraction to avoid
 * namespace-prefix fragility with @xmldom/xmldom (CII uses rsm:/ram:/udt: prefixes
 * that vary per implementation). Fields are extracted on a best-effort basis;
 * parse failures are surfaced in `parseErrors` without throwing.
 *
 * Per `einvoice-cii-validation-gotcha` memory: do NOT round-trip CII via
 * @e-invoice-eu/core fromXml — it has a known bug. Parse structurally instead.
 */

export interface ParsedInboundDocument {
  invoiceNumber?: string;
  issueDate?: string;        // "YYYY-MM-DD"
  sellerName?: string;
  sellerTaxId?: string;
  buyerTaxId?: string;
  currency?: string;
  totalNet?: number;
  totalTax?: number;
  totalGross?: number;
  parseErrors: string[];
}

export type InboundSyntax = 'CII' | 'UBL' | 'FATTURAPA' | 'FA_VAT' | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Helpers — namespace-agnostic XML extraction via regex
// ---------------------------------------------------------------------------

/**
 * Extract the text content of the *first* occurrence of a tag (any namespace prefix).
 * Handles: <Tag>text</Tag>, <ns:Tag>text</ns:Tag>, <Tag attr="…">text</Tag>.
 * Does NOT handle CDATA or mixed content — sufficient for e-invoice atomic fields.
 */
function extractText(xml: string, ...tagNames: string[]): string | undefined {
  for (const tag of tagNames) {
    const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // allow any ns prefix before the local name; optional attributes after the name
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

/**
 * Extract the full XML block (opening tag through closing tag) for a given local name.
 * Used to scope child lookups to a sub-element (e.g. SellerTradeParty).
 */
function extractBlock(xml: string, tagName: string): string | undefined {
  const esc = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(<(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}(?:\\s[^>]*)?>)[\\s\\S]*?(<\\/(?:[A-Za-z_][A-Za-z0-9_.\\-]*:)?${esc}>)`,
    'i',
  );
  const m = xml.match(re);
  return m ? m[0] : undefined;
}

function toFloat(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

/** Normalise a raw CII date string (yyyyMMdd → YYYY-MM-DD, or pass through ISO). */
function normaliseCiiDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return t;
}

// ---------------------------------------------------------------------------
// Per-syntax parsers
// ---------------------------------------------------------------------------

/** EN16931 CII (Factur-X / ZUGFeRD / XRechnung) */
function parseCii(xml: string): ParsedInboundDocument {
  // Invoice number — first <ID> that is NOT inside an address/party ID block
  // The ExchangedDocument block contains the invoice ID.
  const exchBlock = extractBlock(xml, 'ExchangedDocument');
  const invoiceNumber = exchBlock ? extractText(exchBlock, 'ID') : extractText(xml, 'ID');

  // Issue date is in ExchangedDocument > IssueDateTime > DateTimeString
  const issueRaw = extractText(xml, 'DateTimeString');
  const issueDate = normaliseCiiDate(issueRaw);

  // Seller — SellerTradeParty
  const sellerBlock = extractBlock(xml, 'SellerTradeParty');
  const sellerName = sellerBlock ? extractText(sellerBlock, 'Name') : undefined;
  const sellerTaxRegBlock = sellerBlock ? extractBlock(sellerBlock, 'SpecifiedTaxRegistration') : undefined;
  const sellerTaxId = sellerTaxRegBlock ? extractText(sellerTaxRegBlock, 'ID') : undefined;

  // Buyer — BuyerTradeParty
  const buyerBlock = extractBlock(xml, 'BuyerTradeParty');
  const buyerTaxRegBlock = buyerBlock ? extractBlock(buyerBlock, 'SpecifiedTaxRegistration') : undefined;
  const buyerTaxId = buyerTaxRegBlock ? extractText(buyerTaxRegBlock, 'ID') : undefined;

  // Currency
  const currency = extractText(xml, 'InvoiceCurrencyCode');

  // Amounts — SpecifiedTradeSettlementHeaderMonetarySummation
  const summBlock = extractBlock(xml, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const totalNet = toFloat(
    summBlock ? (extractText(summBlock, 'LineTotalAmount') ?? extractText(summBlock, 'TaxBasisTotalAmount')) : undefined,
  );
  const totalTax = toFloat(summBlock ? extractText(summBlock, 'TaxTotalAmount') : undefined);
  const totalGross = toFloat(summBlock ? extractText(summBlock, 'GrandTotalAmount') : undefined);

  return { invoiceNumber, issueDate, sellerName, sellerTaxId, buyerTaxId, currency, totalNet, totalTax, totalGross, parseErrors: [] };
}

/** UBL 2.1 (EN16931_UBL / PEPPOL_BIS) */
function parseUbl(xml: string): ParsedInboundDocument {
  const invoiceNumber = extractText(xml, 'ID');
  const issueDate = extractText(xml, 'IssueDate');
  const currency = extractText(xml, 'DocumentCurrencyCode');

  const supplierBlock = extractBlock(xml, 'AccountingSupplierParty');
  const sellerName = supplierBlock
    ? extractText(supplierBlock, 'Name') ?? extractText(supplierBlock, 'RegistrationName')
    : undefined;
  const sellerTaxId = supplierBlock
    ? extractText(supplierBlock, 'CompanyID') ?? extractText(supplierBlock, 'EndpointID')
    : undefined;

  const customerBlock = extractBlock(xml, 'AccountingCustomerParty');
  const buyerTaxId = customerBlock
    ? extractText(customerBlock, 'CompanyID') ?? extractText(customerBlock, 'EndpointID')
    : undefined;

  const legalBlock = extractBlock(xml, 'LegalMonetaryTotal');
  const totalNet = toFloat(legalBlock ? extractText(legalBlock, 'TaxExclusiveAmount') : undefined);
  const totalGross = toFloat(legalBlock ? extractText(legalBlock, 'PayableAmount') ?? extractText(legalBlock, 'TaxInclusiveAmount') : undefined);

  const taxBlock = extractBlock(xml, 'TaxTotal');
  const totalTax = toFloat(taxBlock ? extractText(taxBlock, 'TaxAmount') : undefined);

  return { invoiceNumber, issueDate, sellerName, sellerTaxId, buyerTaxId, currency, totalNet, totalTax, totalGross, parseErrors: [] };
}

/** FatturaPA 1.2 (IT SdI) */
function parseFatturaPA(xml: string): ParsedInboundDocument {
  const errors: string[] = [];

  // Seller — CedentePrestatore
  const cedenteBlock = extractBlock(xml, 'CedentePrestatore');
  let sellerName: string | undefined;
  let sellerTaxId: string | undefined;
  if (cedenteBlock) {
    const denominazione = extractText(cedenteBlock, 'Denominazione');
    const nomeCognome = [extractText(cedenteBlock, 'Nome'), extractText(cedenteBlock, 'Cognome')].filter(Boolean).join(' ') || undefined;
    sellerName = denominazione ?? nomeCognome;
    sellerTaxId = extractText(cedenteBlock, 'IdCodice') ?? extractText(cedenteBlock, 'CodiceFiscale');
  }

  // Buyer — CessionarioCommittente
  const cessionarioBlock = extractBlock(xml, 'CessionarioCommittente');
  const buyerTaxId = cessionarioBlock
    ? extractText(cessionarioBlock, 'IdCodice') ?? extractText(cessionarioBlock, 'CodiceFiscale')
    : undefined;

  // Body — first DatiGeneraliDocumento
  const datiBlock = extractBlock(xml, 'DatiGeneraliDocumento');
  const invoiceNumber = datiBlock ? extractText(datiBlock, 'Numero') : undefined;
  const issueDate = datiBlock ? extractText(datiBlock, 'Data') : undefined;
  const currency = datiBlock ? extractText(datiBlock, 'Divisa') : 'EUR';
  const totalGross = toFloat(datiBlock ? extractText(datiBlock, 'ImportoTotaleDocumento') : undefined);

  // Totals from DatiRiepilogo blocks (may be multiple — sum them)
  let totalNet: number | undefined;
  let totalTax: number | undefined;
  const datiRiepilogoRe = /<(?:[A-Za-z_][A-Za-z0-9_.]*:)?DatiRiepilogo(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z_][A-Za-z0-9_.]*:)?DatiRiepilogo>/gi;
  for (const match of xml.matchAll(datiRiepilogoRe)) {
    const block = match[0];
    const imp = toFloat(extractText(block, 'ImponibileImporto'));
    const iva = toFloat(extractText(block, 'Imposta'));
    if (imp !== undefined) totalNet = (totalNet ?? 0) + imp;
    if (iva !== undefined) totalTax = (totalTax ?? 0) + iva;
  }

  if (!invoiceNumber) errors.push('FatturaPA: DatiGeneraliDocumento/Numero not found');

  return { invoiceNumber, issueDate, sellerName, sellerTaxId, buyerTaxId, currency, totalNet, totalTax, totalGross, parseErrors: errors };
}

/** FA(2) / FA_VAT — KSeF Polish e-invoice (JSON) */
function parseFaVat(raw: string): ParsedInboundDocument {
  try {
    const obj: Record<string, unknown> = JSON.parse(raw);
    // KSeF wraps in { Faktura: { ... } } at the top level
    const root = (obj?.Faktura ?? obj) as Record<string, unknown>;
    const podmiot1 = (root?.Podmiot1 as Record<string, unknown>)?.DaneIdentyfikacyjne as Record<string, unknown> | undefined;
    const podmiot2 = (root?.Podmiot2 as Record<string, unknown>)?.DaneIdentyfikacyjne as Record<string, unknown> | undefined;
    const fa = root?.Fa as Record<string, unknown> | undefined;

    const sellerName = podmiot1?.PelnaNazwa as string | undefined ?? podmiot1?.ImieNazwisko as string | undefined;
    const sellerTaxId = podmiot1?.NIP as string | undefined;
    const buyerTaxId = podmiot2?.NIP as string | undefined;

    const invoiceNumber = fa?.P_2 as string | undefined ?? fa?.NrFa as string | undefined;
    const issueDate = fa?.P_1 as string | undefined;
    const currency = fa?.KodWaluty as string | undefined ?? 'PLN';

    // FA(2) totals: P_13_x = net per rate, P_14_x = tax, P_15 = gross
    const totalGross = toFloat(String(fa?.P_15 ?? ''));
    // Net = sum of all P_13_x fields; Tax = sum of all P_14_x fields
    let totalNet: number | undefined;
    let totalTax: number | undefined;
    for (const [k, v] of Object.entries(fa ?? {})) {
      if (/^P_13_\d+$/.test(k) || k === 'P_13_1') {
        totalNet = (totalNet ?? 0) + (toFloat(String(v)) ?? 0);
      }
      if (/^P_14_\d+$/.test(k) || k === 'P_14_1') {
        totalTax = (totalTax ?? 0) + (toFloat(String(v)) ?? 0);
      }
    }

    return { invoiceNumber, issueDate, sellerName, sellerTaxId, buyerTaxId, currency, totalNet, totalTax, totalGross, parseErrors: [] };
  } catch (e) {
    return { parseErrors: [`FA_VAT JSON parse error: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Detect document syntax from the raw payload. */
export function detectSyntax(raw: string): InboundSyntax {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'FA_VAT';
  if (
    trimmed.includes('CrossIndustryInvoice') ||
    trimmed.includes(':CrossIndustryInvoice') ||
    trimmed.includes('rsm:') ||
    trimmed.includes('urn:un:unece:uncefact:data:standard:CrossIndustryInvoice')
  )
    return 'CII';
  if (trimmed.includes('FatturaElettronica') || trimmed.includes('CedentePrestatore') || trimmed.includes('FatturaPA'))
    return 'FATTURAPA';
  if (
    trimmed.includes('urn:oasis:names:specification:ubl') ||
    trimmed.includes('<Invoice') ||
    trimmed.includes('<ubl:Invoice') ||
    trimmed.includes('AccountingSupplierParty')
  )
    return 'UBL';
  return 'UNKNOWN';
}

/**
 * Parse an inbound document into canonical fields.
 * `syntaxHint` (e.g. "EN16931_CII") maps to the short forms used internally:
 * CII | UBL | FATTURAPA | FA_VAT. When omitted, syntax is auto-detected.
 */
export function parseInboundDocument(raw: string, syntaxHint?: string | null): ParsedInboundDocument {
  // Normalise syntaxHint to short form
  let syntax: InboundSyntax;
  if (!syntaxHint) {
    syntax = detectSyntax(raw);
  } else if (/CII|FACTURX|ZUGFERD|XRECHNUNG/i.test(syntaxHint)) {
    syntax = 'CII';
  } else if (/UBL|PEPPOL/i.test(syntaxHint)) {
    syntax = 'UBL';
  } else if (/FATTURAPA|FATTURAELECTRONICA/i.test(syntaxHint)) {
    syntax = 'FATTURAPA';
  } else if (/FA_VAT|FA2|FAKTURA/i.test(syntaxHint)) {
    syntax = 'FA_VAT';
  } else {
    syntax = detectSyntax(raw);
  }

  switch (syntax) {
    case 'CII':      return parseCii(raw);
    case 'UBL':      return parseUbl(raw);
    case 'FATTURAPA':return parseFatturaPA(raw);
    case 'FA_VAT':   return parseFaVat(raw);
    default: {
      // Best-effort fallback: try CII first (most prevalent in EU), then UBL
      const ciiResult = parseCii(raw);
      if (ciiResult.invoiceNumber || ciiResult.sellerName) {
        return { ...ciiResult, parseErrors: ['syntax auto-detected as CII (unknown hint)'] };
      }
      const ublResult = parseUbl(raw);
      if (ublResult.invoiceNumber || ublResult.sellerName) {
        return { ...ublResult, parseErrors: ['syntax auto-detected as UBL (unknown hint)'] };
      }
      return { parseErrors: ['could not detect syntax or extract any fields from payload'] };
    }
  }
}
