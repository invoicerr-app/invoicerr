/**
 * Pure reporting payload generators (§6 — COMPLIANCE_TODO.md).
 *
 * Each generator is a deterministic function: (TransactionContext, CompliancePlan) → payload.
 * No I/O, no side effects — fully unit-testable.  Submission is the caller's responsibility.
 *
 * Amounts: computed from ctx.lines (unitNetMinor × quantity) and the per-line tax treatment
 * stored in plan.tax.  All monetary amounts in the payload are decimal strings (currency/2dp) to
 * avoid floating-point drift in JSON serialisation.
 *
 * SAF-T: OECD SAF-T "Accounting" SalesInvoice entry generated via xmlbuilder2 (already in deps).
 * The namespace used is the generic OECD SAF-T 2.0 draft URI; country-specific variants (PT
 * 1.04, PL SAF-T, NO SAF-T) extend this and will be handled by country-specific providers later.
 */
import { create } from 'xmlbuilder2';
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { accumulateTotals } from '../taxsystems/tax-system';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minorToDecimal(minor: number, decimals: number): string {
  return (minor / Math.pow(10, decimals)).toFixed(decimals);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buyerVatId(ctx: TransactionContext): string | undefined {
  return ctx.buyer.identifiers.find((id) => id.scheme === 'VAT')?.value;
}

function supplierVatId(ctx: TransactionContext): string | undefined {
  return ctx.supplier.identifiers.find((id) => id.scheme === 'VAT')?.value;
}

function supplierLegalId(ctx: TransactionContext): string | undefined {
  return (
    ctx.supplier.identifiers.find((id) => id.scheme === 'SIRET' || id.scheme === 'SIREN' || id.scheme === 'NIP')
      ?.value ?? ctx.supplier.identifiers[0]?.value
  );
}

// ---------------------------------------------------------------------------
// E_REPORTING — FR B2C & cross-border (e-reporting obligatoire)
// ---------------------------------------------------------------------------

export interface EReportingPayload {
  /** ISO period key e.g. "2026-06" */
  periodKey: string;
  /** "B2C_DOMESTIC" | "B2C_CROSS_BORDER" | "B2B_CROSS_BORDER" */
  transactionType: string;
  transactionDate: string;
  documentRef: string | undefined;
  supplierVatId: string | undefined;
  supplierSiret: string | undefined;
  buyerCountry: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  currency: string;
  vatCategory: string;
  vatRate: number;
  /** Whether the buyer is liable to self-assess (reverse charge) */
  buyerSelfAssess: boolean;
}

export function generateEReportingPayload(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): EReportingPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;

  const crossBorder = plan.classification.crossBorder;
  const buyerRole = plan.classification.buyerRole;
  const transactionType =
    buyerRole === 'B2B' && crossBorder
      ? 'B2B_CROSS_BORDER'
      : crossBorder
        ? 'B2C_CROSS_BORDER'
        : 'B2C_DOMESTIC';

  const firstLineTax = plan.tax.lines[0]?.treatment.components[0];

  return {
    periodKey,
    transactionType,
    transactionDate: isoDate(ctx.issueDate),
    documentRef: ctx.externalRef,
    supplierVatId: supplierVatId(ctx),
    supplierSiret: supplierLegalId(ctx),
    buyerCountry: ctx.buyer.countryCode,
    netAmount: minorToDecimal(totals.net.minor, decimals),
    vatAmount: minorToDecimal(totals.tax.minor, decimals),
    grossAmount: minorToDecimal(totals.gross.minor, decimals),
    currency: ctx.currency,
    vatCategory: firstLineTax?.category ?? 'S',
    vatRate: firstLineTax?.rate ?? 0,
    buyerSelfAssess: plan.tax.buyerSelfAssess,
  };
}

// ---------------------------------------------------------------------------
// SAF-T — OECD Standard Audit File for Tax (SalesInvoice entry, XML)
// ---------------------------------------------------------------------------

export interface SaftEntryPayload {
  xml: string;
  /** Structured metadata for indexing without XML parsing */
  meta: {
    periodKey: string;
    invoiceNo: string | undefined;
    invoiceDate: string;
    customerName: string;
    netTotal: string;
    taxPayable: string;
    grossTotal: string;
    currency: string;
  };
}

export function generateSaftEntry(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): SaftEntryPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;
  const date = isoDate(ctx.issueDate);
  const invoiceNo = ctx.externalRef ?? 'UNKNOWN';
  const month = ctx.issueDate.getUTCMonth() + 1;
  const year = ctx.issueDate.getUTCFullYear();

  // Build OECD SAF-T 1.04 SalesInvoice XML using xmlbuilder2 (imperative style for line loop)
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const auditFile = doc.ele('AuditFile', {
    xmlns: 'urn:StandardAuditFile-Tax:PT_1.04_01',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  });

  // Header
  const header = auditFile.ele('Header');
  header.ele('AuditFileVersion').txt('1.04_01');
  header.ele('CompanyID').txt(supplierLegalId(ctx) ?? '');
  header.ele('TaxRegistrationNumber').txt(supplierVatId(ctx) ?? '');
  header.ele('TaxAccountingBasis').txt('I'); // I = Invoicing
  header.ele('CompanyName').txt(ctx.supplier.legalName);
  header.ele('FiscalYear').txt(String(year));
  header.ele('StartDate').txt(`${year}-01-01`);
  header.ele('EndDate').txt(`${year}-12-31`);
  header.ele('CurrencyCode').txt(ctx.currency);
  header.ele('DateCreated').txt(new Date().toISOString().slice(0, 10));
  header.ele('ProductID').txt('Invoicerr');
  header.ele('ProductVersion').txt('1.0');

  // SourceDocuments → SalesInvoices → Invoice
  const srcDocs = auditFile.ele('SourceDocuments');
  const salesInvoices = srcDocs.ele('SalesInvoices');
  salesInvoices.ele('NumberOfEntries').txt('1');
  salesInvoices.ele('TotalDebit').txt('0.00');
  salesInvoices.ele('TotalCredit').txt(minorToDecimal(totals.gross.minor, decimals));

  const invoice = salesInvoices.ele('Invoice');
  invoice.ele('InvoiceNo').txt(invoiceNo);
  invoice.ele('Period').txt(String(month));
  invoice.ele('InvoiceDate').txt(date);
  invoice.ele('InvoiceType').txt(ctx.documentKind === 'CREDIT_NOTE' ? 'NC' : 'FT');
  invoice.ele('CustomerID').txt(ctx.buyer.legalName);

  const docStatus = invoice.ele('DocumentStatus');
  docStatus.ele('InvoiceStatus').txt('N'); // N = Normal
  docStatus.ele('InvoiceStatusDate').txt(`${date}T00:00:00`);
  docStatus.ele('SourceID').txt('Invoicerr');
  docStatus.ele('SourceBilling').txt('P'); // P = Produced by the taxpayer

  // Lines
  ctx.lines.forEach((line, idx) => {
    const lineNet = Math.round(line.unitNetMinor * line.quantity);
    const treatment = plan.tax.lines.find((l) => l.lineId === line.id)?.treatment;
    const comp = treatment?.components[0];
    const lineEl = invoice.ele('Line');
    lineEl.ele('LineNumber').txt(String(idx + 1));
    lineEl.ele('ProductCode').txt(line.id);
    lineEl.ele('ProductDescription').txt(line.description);
    lineEl.ele('Quantity').txt(String(line.quantity));
    lineEl.ele('UnitPrice').txt(minorToDecimal(line.unitNetMinor, decimals));
    lineEl.ele('TaxPointDate').txt(date);
    lineEl.ele('Description').txt(line.description);
    lineEl.ele('DebitAmount').txt('0.00');
    lineEl.ele('CreditAmount').txt(minorToDecimal(lineNet, decimals));
    const taxEl = lineEl.ele('Tax');
    taxEl.ele('TaxType').txt('VAT');
    taxEl.ele('TaxCountryRegion').txt(ctx.supplier.countryCode);
    taxEl.ele('TaxCode').txt(comp?.category ?? 'S');
    taxEl.ele('TaxPercentage').txt(String(comp?.rate ?? 0));
  });

  // DocumentTotals
  const docTotals = invoice.ele('DocumentTotals');
  docTotals.ele('TaxPayable').txt(minorToDecimal(totals.tax.minor, decimals));
  docTotals.ele('NetTotal').txt(minorToDecimal(totals.net.minor, decimals));
  docTotals.ele('GrossTotal').txt(minorToDecimal(totals.gross.minor, decimals));

  return {
    xml: doc.end({ prettyPrint: true }),
    meta: {
      periodKey,
      invoiceNo: ctx.externalRef,
      invoiceDate: date,
      customerName: ctx.buyer.legalName,
      netTotal: minorToDecimal(totals.net.minor, decimals),
      taxPayable: minorToDecimal(totals.tax.minor, decimals),
      grossTotal: minorToDecimal(totals.gross.minor, decimals),
      currency: ctx.currency,
    },
  };
}

// ---------------------------------------------------------------------------
// OSS — EU One-Stop-Shop VAT return (distance sales / digital services B2C)
// ---------------------------------------------------------------------------

export interface OssEntryPayload {
  periodKey: string;
  memberStateDest: string;
  supplyType: string;
  netAmount: string;
  vatRate: number;
  vatAmount: string;
  currency: string;
  transactionDate: string;
  documentRef: string | undefined;
}

export function generateOssEntry(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): OssEntryPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;
  const firstComp = plan.tax.lines[0]?.treatment.components[0];
  const supplyTypes = plan.classification.supplyTypes;

  return {
    periodKey,
    memberStateDest: ctx.buyer.countryCode,
    supplyType: supplyTypes.includes('GOODS') ? 'GOODS' : supplyTypes.includes('DIGITAL') ? 'DIGITAL_SERVICES' : 'SERVICES',
    netAmount: minorToDecimal(totals.net.minor, decimals),
    vatRate: firstComp?.rate ?? 0,
    vatAmount: minorToDecimal(totals.tax.minor, decimals),
    currency: ctx.currency,
    transactionDate: isoDate(ctx.issueDate),
    documentRef: ctx.externalRef,
  };
}

// ---------------------------------------------------------------------------
// IOSS — EU Import One-Stop-Shop (imported goods ≤ EUR 150)
// ---------------------------------------------------------------------------

export interface IossEntryPayload {
  periodKey: string;
  customerCountry: string;
  goodsValue: string;
  vatRate: number;
  vatAmount: string;
  currency: string;
  transactionDate: string;
  documentRef: string | undefined;
  iossNumber: string | undefined;
}

export function generateIossEntry(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): IossEntryPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;
  const firstComp = plan.tax.lines[0]?.treatment.components[0];
  const iossId = ctx.supplier.identifiers.find((id) => id.scheme === 'IOSS')?.value;

  return {
    periodKey,
    customerCountry: ctx.buyer.countryCode,
    goodsValue: minorToDecimal(totals.net.minor, decimals),
    vatRate: firstComp?.rate ?? 0,
    vatAmount: minorToDecimal(totals.tax.minor, decimals),
    currency: ctx.currency,
    transactionDate: isoDate(ctx.issueDate),
    documentRef: ctx.externalRef,
    iossNumber: iossId,
  };
}

// ---------------------------------------------------------------------------
// EC_SALES_LIST — Recapitulatif / ESL (intra-Community B2B supplies)
// ---------------------------------------------------------------------------

export interface EcSalesListEntryPayload {
  periodKey: string;
  buyerVatId: string | undefined;
  buyerCountry: string;
  netAmount: string;
  currency: string;
  /** "GOODS" | "SERVICES" | "TRIANGULAR" */
  transactionType: string;
  transactionDate: string;
  documentRef: string | undefined;
}

export function generateEcSalesListEntry(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): EcSalesListEntryPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;
  const supplyTypes = plan.classification.supplyTypes;

  return {
    periodKey,
    buyerVatId: buyerVatId(ctx),
    buyerCountry: ctx.buyer.countryCode,
    netAmount: minorToDecimal(totals.net.minor, decimals),
    currency: ctx.currency,
    transactionType: supplyTypes.includes('GOODS') ? 'GOODS' : 'SERVICES',
    transactionDate: isoDate(ctx.issueDate),
    documentRef: ctx.externalRef,
  };
}

// ---------------------------------------------------------------------------
// INTRASTAT — EU trade statistics (goods crossing EU borders)
// ---------------------------------------------------------------------------

export interface IntrastatEntryPayload {
  periodKey: string;
  /** "DISPATCH" (export) | "ARRIVAL" (import — for reverse charge inbound) */
  declarationType: 'DISPATCH' | 'ARRIVAL';
  partnerCountry: string;
  /** HS/CN commodity code — not available from canonical doc, populated as "" */
  commodityCode: string;
  statisticalValue: string;
  currency: string;
  transactionDate: string;
  documentRef: string | undefined;
  supplierVatId: string | undefined;
}

export function generateIntrastatEntry(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): IntrastatEntryPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;

  // Dispatch = supplier is sending goods out; the flag comes from the tax treatment (category K = intra-Community)
  const isDispatch = plan.tax.lines.some((l) =>
    l.treatment.components.some((c) => c.category === 'K'),
  );

  return {
    periodKey,
    declarationType: isDispatch ? 'DISPATCH' : 'ARRIVAL',
    partnerCountry: plan.classification.crossBorder ? ctx.buyer.countryCode : ctx.supplier.countryCode,
    commodityCode: '', // must be enriched by user / product catalogue
    statisticalValue: minorToDecimal(totals.net.minor, decimals),
    currency: ctx.currency,
    transactionDate: isoDate(ctx.issueDate),
    documentRef: ctx.externalRef,
    supplierVatId: supplierVatId(ctx),
  };
}

// ---------------------------------------------------------------------------
// SALES_PURCHASE_LEDGER — daily/monthly sales register (PE SIRE, CL libro diario…)
// ---------------------------------------------------------------------------

export interface SalesPurchaseLedgerEntryPayload {
  periodKey: string;
  documentDate: string;
  documentRef: string | undefined;
  documentType: string;
  buyerName: string;
  buyerVatId: string | undefined;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  currency: string;
  vatRate: number;
}

export function generateSalesPurchaseLedgerEntry(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): SalesPurchaseLedgerEntryPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;
  const firstComp = plan.tax.lines[0]?.treatment.components[0];

  return {
    periodKey,
    documentDate: isoDate(ctx.issueDate),
    documentRef: ctx.externalRef,
    documentType: ctx.documentKind ?? 'INVOICE',
    buyerName: ctx.buyer.legalName,
    buyerVatId: buyerVatId(ctx),
    netAmount: minorToDecimal(totals.net.minor, decimals),
    vatAmount: minorToDecimal(totals.tax.minor, decimals),
    grossAmount: minorToDecimal(totals.gross.minor, decimals),
    currency: ctx.currency,
    vatRate: firstComp?.rate ?? 0,
  };
}

// ---------------------------------------------------------------------------
// CUSTOMS_EXPORT — zero-rated export evidence (EU Art. 146 / comparable)
// ---------------------------------------------------------------------------

export interface CustomsExportPayload {
  exportDate: string;
  documentRef: string | undefined;
  exporterVatId: string | undefined;
  buyerCountry: string;
  goodsDescription: string;
  customsValue: string;
  currency: string;
  /** "ZERO_RATED_EXPORT" | "FREE_EXPORT" */
  exportBasis: string;
}

export function generateCustomsExportPayload(
  ctx: TransactionContext,
  plan: CompliancePlan,
): CustomsExportPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;

  // Export basis: goods leaving the EU union → zero-rated (Art. 146); otherwise free-export
  const isZeroRatedExport = plan.tax.lines.some((l) =>
    l.treatment.components.some((c) => c.category === 'G'),
  );

  const descriptions = ctx.lines.map((l) => l.description).join('; ');

  return {
    exportDate: isoDate(ctx.issueDate),
    documentRef: ctx.externalRef,
    exporterVatId: supplierVatId(ctx),
    buyerCountry: ctx.buyer.countryCode,
    goodsDescription: descriptions,
    customsValue: minorToDecimal(totals.net.minor, decimals),
    currency: ctx.currency,
    exportBasis: isZeroRatedExport ? 'ZERO_RATED_EXPORT' : 'FREE_EXPORT',
  };
}
