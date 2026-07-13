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
 *
 * SII / Verifactu (Spain, AEAT): element/namespace names verified directly against the official
 * AEAT XSDs (SuministroInformacion.xsd, SuministroLR.xsd — sede.agenciatributaria.gob.es) and the
 * official "Detalle de las especificaciones técnicas para la generación de la huella o hash de los
 * registros de facturación" (v0.1.2, 27/08/2024) + "Detalle de las especificaciones técnicas del
 * código QR..." (v0.5.0, 10/12/2025) PDFs. See generateSiiRegistroPayload / generateVerifactuRegistroPayload.
 */
import { createHash } from 'node:crypto';
import { create } from 'xmlbuilder2';
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { accumulateTotals } from '../taxsystems/tax-system';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minorToDecimal(minor: number, decimals: number): string {
  return (minor / 10 ** decimals).toFixed(decimals);
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
    ctx.supplier.identifiers.find(
      (id) => id.scheme === 'SIRET' || id.scheme === 'SIREN' || id.scheme === 'NIP',
    )?.value ?? ctx.supplier.identifiers[0]?.value
  );
}

/**
 * AEAT date format used throughout SII (`sii:fecha` simpleType) and Verifactu (`FechaExpedicionFactura`,
 * QR `fecha` param): "dd-mm-yyyy" — confirmed both by the SuministroInformacion.xsd pattern
 * `\d{2}-\d{2}-\d{4}` and by the official Verifactu huella worked example ("01-01-2024").
 */
function ddmmyyyy(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getUTCFullYear()}`;
}

/**
 * AEAT `NIFType` is a bare 9-character NIF/CIF/NIE (no "ES" country prefix) — strip it if the
 * canonical identifier carries one (this codebase's VAT identifiers are ISO-prefixed, e.g. "ES...").
 */
function toNif(v: string | undefined): string {
  if (!v) return '';
  const upper = v.trim().toUpperCase();
  return upper.startsWith('ES') && upper.length === 11 ? upper.slice(2) : upper;
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
    supplyType: supplyTypes.includes('GOODS')
      ? 'GOODS'
      : supplyTypes.includes('DIGITAL')
        ? 'DIGITAL_SERVICES'
        : 'SERVICES',
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
  const isDispatch = plan.tax.lines.some((l) => l.treatment.components.some((c) => c.category === 'K'));

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

// ---------------------------------------------------------------------------
// SII — Spain, AEAT "Suministro Inmediato de Información" (LibroRegistro upload)
//
// Produces the SuministroLRFacturasEmitidas registration (issued-invoice ledger) as defined by
// the official AEAT schemas SuministroInformacion.xsd + SuministroLR.xsd (namespaces below are
// the exact targetNamespace URIs declared in those XSDs, fetched from
// sede.agenciatributaria.gob.es/static_files/Sede/Procedimiento_ayuda/G417/FicherosSuministros/V_1_1/).
// Element names, nesting and enumerations (TipoComunicacion=A0, TipoFactura=F1/R1,
// ClaveRegimenEspecialOTrascendencia=01 "régimen general", TipoNoExenta=S1 "no exenta sin
// inversión del sujeto pasivo") are taken verbatim from those XSDs — not invented.
// ---------------------------------------------------------------------------

const SII_NS =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroInformacion.xsd';
const SII_LR_NS =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroLR.xsd';

export interface SiiRegistroPayload {
  xml: string;
  /** Structured metadata for indexing without XML parsing (mirrors SaftEntryPayload's shape). */
  meta: {
    periodKey: string;
    ejercicio: string;
    periodo: string;
    nifEmisor: string;
    numSerieFactura: string;
    fechaExpedicion: string;
    tipoFactura: string;
    importeTotal: string;
    cuotaTotal: string;
  };
}

export function generateSiiRegistroPayload(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
): SiiRegistroPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;

  const nifEmisor = toNif(supplierVatId(ctx));
  const numSerieFactura = ctx.externalRef ?? 'UNKNOWN';
  const fechaExpedicion = ddmmyyyy(ctx.issueDate);
  const ejercicio = String(ctx.issueDate.getUTCFullYear());
  const periodo = String(ctx.issueDate.getUTCMonth() + 1).padStart(2, '0');
  // ClaveTipoFacturaType: F1 = FACTURA (normal); R1 = FACTURA RECTIFICATIVA (Art 80.1/80.2/error de derecho).
  const tipoFactura =
    ctx.documentKind === 'CREDIT_NOTE' || ctx.documentKind === 'CORRECTIVE_INVOICE' ? 'R1' : 'F1';
  const importeTotal = minorToDecimal(totals.gross.minor, decimals);
  const cuotaTotal = minorToDecimal(totals.tax.minor, decimals);
  const descripcion = ctx.lines.map((l) => l.description).join('; ') || 'Operación comercial';

  // Per-rate VAT breakdown (DesgloseIVA/DetalleIVA — one entry per distinct TipoImpositivo).
  const byRate = new Map<number, { base: number; cuota: number }>();
  for (const line of ctx.lines) {
    const lineNet = Math.round(line.unitNetMinor * line.quantity);
    const comp = plan.tax.lines.find((l) => l.lineId === line.id)?.treatment.components[0];
    const rate = comp?.rate ?? 0;
    const cuota = comp && comp.rate > 0 ? Math.round(lineNet * (comp.rate / 100)) : 0;
    const acc = byRate.get(rate) ?? { base: 0, cuota: 0 };
    acc.base += lineNet;
    acc.cuota += cuota;
    byRate.set(rate, acc);
  }

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('siiLR:SuministroLRFacturasEmitidas', {
    'xmlns:sii': SII_NS,
    'xmlns:siiLR': SII_LR_NS,
  });

  // Cabecera (sii:CabeceraSii): IDVersionSii, Titular{NombreRazon, NIF}, TipoComunicacion.
  const cabecera = root.ele('sii:Cabecera');
  cabecera.ele('sii:IDVersionSii').txt('1.1');
  const titular = cabecera.ele('sii:Titular');
  titular.ele('sii:NombreRazon').txt(ctx.supplier.legalName);
  titular.ele('sii:NIF').txt(nifEmisor);
  cabecera.ele('sii:TipoComunicacion').txt('A0'); // A0 = Alta (nueva factura)

  // RegistroLRFacturasEmitidas (siiLR:LRfacturasEmitidasType, extends sii:RegistroSii).
  const registro = root.ele('siiLR:RegistroLRFacturasEmitidas');
  const periodoLiquidacion = registro.ele('sii:PeriodoLiquidacion');
  periodoLiquidacion.ele('sii:Ejercicio').txt(ejercicio);
  periodoLiquidacion.ele('sii:Periodo').txt(periodo);

  // IDFactura (sii:IDFacturaExpedidaType).
  const idFactura = registro.ele('sii:IDFactura');
  idFactura.ele('sii:IDEmisorFactura').ele('sii:NIF').txt(nifEmisor);
  idFactura.ele('sii:NumSerieFacturaEmisor').txt(numSerieFactura);
  idFactura.ele('sii:FechaExpedicionFacturaEmisor').txt(fechaExpedicion);

  // FacturaExpedida (sii:FacturaExpedidaType, extends sii:FacturaType).
  const facturaExpedida = registro.ele('sii:FacturaExpedida');
  facturaExpedida.ele('sii:TipoFactura').txt(tipoFactura);
  facturaExpedida.ele('sii:ClaveRegimenEspecialOTrascendencia').txt('01');
  facturaExpedida.ele('sii:ImporteTotal').txt(importeTotal);
  facturaExpedida.ele('sii:DescripcionOperacion').txt(descripcion);

  const contraparte = facturaExpedida.ele('sii:Contraparte');
  contraparte.ele('sii:NombreRazon').txt(ctx.buyer.legalName);
  const buyerVat = buyerVatId(ctx);
  if (ctx.buyer.countryCode === 'ES') {
    contraparte.ele('sii:NIF').txt(toNif(buyerVat));
  } else {
    // PersonaFisicaJuridicaType choice: NIF | IDOtro{CodigoPais, IDType, ID}. IDType=02 "NIF-IVA".
    const idOtro = contraparte.ele('sii:IDOtro');
    idOtro.ele('sii:CodigoPais').txt(ctx.buyer.countryCode);
    idOtro.ele('sii:IDType').txt('02');
    idOtro.ele('sii:ID').txt(buyerVat ?? '');
  }

  // TipoDesglose → DesgloseFactura (TipoSinDesgloseType) → Sujeta → NoExenta → DesgloseIVA → DetalleIVA[].
  const desgloseIVA = facturaExpedida
    .ele('sii:TipoDesglose')
    .ele('sii:DesgloseFactura')
    .ele('sii:Sujeta')
    .ele('sii:NoExenta');
  desgloseIVA.ele('sii:TipoNoExenta').txt('S1'); // No exenta - sin inversión del sujeto pasivo
  const desgloseIVAWrap = desgloseIVA.ele('sii:DesgloseIVA');
  for (const [rate, amounts] of byRate) {
    const detalle = desgloseIVAWrap.ele('sii:DetalleIVA');
    detalle.ele('sii:TipoImpositivo').txt(String(rate));
    detalle.ele('sii:BaseImponible').txt(minorToDecimal(amounts.base, decimals));
    detalle.ele('sii:CuotaRepercutida').txt(minorToDecimal(amounts.cuota, decimals));
  }

  return {
    xml: doc.end({ prettyPrint: true }),
    meta: {
      periodKey,
      ejercicio,
      periodo,
      nifEmisor,
      numSerieFactura,
      fechaExpedicion,
      tipoFactura,
      importeTotal,
      cuotaTotal,
    },
  };
}

// ---------------------------------------------------------------------------
// VERIFACTU — Spain, AEAT anti-fraud hash-chain register (RD 1007/2023 / Orden HAC/1177/2024)
//
// Produces a RegistroAlta with its Huella (SHA-256 hash-chain fingerprint) and the tax QR content
// string. The huella field set, order, and worked SHA-256 example are taken verbatim from the
// official AEAT PDF "Detalle de las especificaciones técnicas para la generación de la huella o
// hash de los registros de facturación" (v0.1.2, 27/08/2024, sede.agenciatributaria.gob.es) — the
// canonical string and algorithm below were verified by reproducing that document's worked
// example byte-for-byte (see generators.spec.ts). The QR URL/params are taken verbatim from
// "Detalle de las especificaciones técnicas del código QR de la factura..." (v0.5.0, 10/12/2025).
// ---------------------------------------------------------------------------

/** Production ValidarQR host (systems emitting Verifactu-verifiable invoices). A pre-production
 *  "Portal de Pruebas Externas" host (prewww2.aeat.es) exists for testing and is documented but
 *  not wired here — swap via config when the transmission channel for ES is implemented. */
const VERIFACTU_QR_BASE = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR';

export interface VerifactuRegistroPayload {
  /** This record's huella (64-char uppercase hex SHA-256). */
  huella: string;
  /** The previous record's huella that was chained into this one ('' if this is the first record). */
  previousHuella: string;
  /** PrimerRegistro='S' in AEAT terms — true when there is no previous record in the chain. */
  primerRegistro: boolean;
  /** AEAT tax QR "ValidarQR" URL content (the caller renders this as a QR image). */
  qrContent: string;
  /** The AEAT RegistroAlta fields that participate in the huella — real field names/paths (see below). */
  registro: {
    /** RegistroAlta/IDFactura/IDEmisorFactura */
    idEmisorFactura: string;
    /** RegistroAlta/IDFactura/NumSerieFactura */
    numSerieFactura: string;
    /** RegistroAlta/IDFactura/FechaExpedicionFactura (dd-mm-yyyy) */
    fechaExpedicionFactura: string;
    /** RegistroAlta/TipoFactura */
    tipoFactura: string;
    /** RegistroAlta/CuotaTotal */
    cuotaTotal: string;
    /** RegistroAlta/ImporteTotal */
    importeTotal: string;
    /** RegistroAlta/FechaHoraHusoGenRegistro (ISO 8601 with UTC offset) */
    fechaHoraHusoGenRegistro: string;
  };
  meta: {
    periodKey: string;
    invoiceNo: string | undefined;
    buyerName: string;
    currency: string;
  };
}

/**
 * previousHuella: the chained-in huella of this issuer's immediately preceding Verifactu record,
 * or '' for the first record ever emitted by this system (PrimerRegistro='S').
 *
 * TODO(seam): fetching "the previous record's huella for this issuer's chain" is a stateful lookup
 * this pure generator deliberately does NOT perform (§ hard rule: generators are pure, no I/O).
 * Production wiring must, per issuer (ctx.supplierCompanyId), read back the last emitted
 * VERIFACTU report's `huella` via ReportingStore (see prisma-reporting-store.ts — e.g. a
 * `findLastByKindAndCompany('VERIFACTU', companyId)` query ordered by creation) and pass its
 * huella as `previousHuella` here before calling this generator. This mirrors the existing
 * AuthorityRangeSource seam pattern (lifecycle/authority-range-source.ts): the algorithm is real
 * and chainable, only the "where does the prior link live" persistence is deferred to the I/O layer.
 */
export function generateVerifactuRegistroPayload(
  ctx: TransactionContext,
  plan: CompliancePlan,
  periodKey: string,
  previousHuella = '',
): VerifactuRegistroPayload {
  const totals = accumulateTotals(ctx, plan.tax);
  const { decimals } = totals.net;

  const idEmisorFactura = toNif(supplierVatId(ctx));
  const numSerieFactura = ctx.externalRef ?? 'UNKNOWN';
  const fechaExpedicionFactura = ddmmyyyy(ctx.issueDate);
  const tipoFactura =
    ctx.documentKind === 'CREDIT_NOTE' || ctx.documentKind === 'CORRECTIVE_INVOICE' ? 'R1' : 'F1';
  const cuotaTotal = minorToDecimal(totals.tax.minor, decimals);
  const importeTotal = minorToDecimal(totals.gross.minor, decimals);
  // Record-generation timestamp (mirrors generateSaftEntry's `new Date()` use for DateCreated).
  // NOTE: AEAT's own worked examples use Europe/Madrid local offset (e.g. "+01:00"); this uses a
  // fixed UTC "+00:00" offset, which is syntactically valid per the `fecha`/Timestamp pattern
  // (\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}) but not wall-clock-accurate for Madrid. A production
  // deployment should localize to Europe/Madrid (DST-aware) before hashing.
  const fechaHoraHusoGenRegistro = `${new Date().toISOString().slice(0, 19)}+00:00`;

  // Huella canonical string — exact field set + order confirmed against AEAT's worked example
  // (see generators.spec.ts, which reproduces the official SHA-256 test vector byte-for-byte):
  //   IDEmisorFactura=..&NumSerieFactura=..&FechaExpedicionFactura=..&TipoFactura=..
  //   &CuotaTotal=..&ImporteTotal=..&Huella=<previous record's huella, '' if none>
  //   &FechaHoraHusoGenRegistro=..
  // Values are NOT URL-encoded here (the official Java reference implementation hashes the raw,
  // trimmed field values — URL-encoding only applies to the separate QR URL, see below).
  const canonical =
    `IDEmisorFactura=${idEmisorFactura}` +
    `&NumSerieFactura=${numSerieFactura}` +
    `&FechaExpedicionFactura=${fechaExpedicionFactura}` +
    `&TipoFactura=${tipoFactura}` +
    `&CuotaTotal=${cuotaTotal}` +
    `&ImporteTotal=${importeTotal}` +
    `&Huella=${previousHuella}` +
    `&FechaHoraHusoGenRegistro=${fechaHoraHusoGenRegistro}`;

  const huella = createHash('sha256').update(Buffer.from(canonical, 'utf-8')).digest('hex').toUpperCase();

  // QR content: AEAT ValidarQR URL with the 4 mandatory params (nif, numserie, fecha, importe),
  // each URL-encoded per "Consideraciones previas sobre la URL del código QR" (UTF-8, standard
  // URL encoding — verified against the official worked example encoding "&" as "%26").
  const qrParams =
    `nif=${encodeURIComponent(idEmisorFactura)}` +
    `&numserie=${encodeURIComponent(numSerieFactura)}` +
    `&fecha=${encodeURIComponent(fechaExpedicionFactura)}` +
    `&importe=${encodeURIComponent(importeTotal)}`;
  const qrContent = `${VERIFACTU_QR_BASE}?${qrParams}`;

  return {
    huella,
    previousHuella,
    primerRegistro: previousHuella === '',
    qrContent,
    registro: {
      idEmisorFactura,
      numSerieFactura,
      fechaExpedicionFactura,
      tipoFactura,
      cuotaTotal,
      importeTotal,
      fechaHoraHusoGenRegistro,
    },
    meta: {
      periodKey,
      invoiceNo: ctx.externalRef,
      buyerName: ctx.buyer.legalName,
      currency: ctx.currency,
    },
  };
}
