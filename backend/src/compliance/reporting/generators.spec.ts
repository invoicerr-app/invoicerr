/**
 * Tests for the pure reporting generators and period/scheduling utilities.
 *
 * All generators receive synthetic TransactionContext + CompliancePlan stubs — no I/O, fully pure.
 */
import { createHash } from 'node:crypto';
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { getPeriodKey, frequencyForKind, ReportFrequency } from './period';
import {
  generateCustomsExportPayload,
  generateEcSalesListEntry,
  generateEReportingPayload,
  generateIossEntry,
  generateIntrastatEntry,
  generateOssEntry,
  generateSaftEntry,
  generateSalesPurchaseLedgerEntry,
  generateSiiRegistroPayload,
  generateVerifactuRegistroPayload,
  verifactuQrBase,
} from './generators';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<TransactionContext> = {}): TransactionContext {
  return {
    supplier: {
      legalName: 'ACME SAS',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [
        { scheme: 'SIRET', value: '12345678901234' },
        { scheme: 'VAT', value: 'FR12123456789' },
      ],
      address: { line1: '1 rue de la Paix', postalCode: '75001', city: 'Paris', countryCode: 'FR' },
    },
    buyer: {
      legalName: 'Client GmbH',
      countryCode: 'DE',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
    },
    lines: [
      {
        id: 'L1',
        description: 'Consulting services',
        quantity: 10,
        unitNetMinor: 10000,
        supplyType: 'SERVICES',
      },
    ],
    issueDate: new Date('2026-06-15T00:00:00Z'),
    currency: 'EUR',
    externalRef: 'INV-2026-001',
    supplierCompanyId: 'company-abc',
    ...overrides,
  } as TransactionContext;
}

function makePlan(overrides: Partial<CompliancePlan> = {}): CompliancePlan {
  return {
    supplier: { country: 'FR', confidence: 'OFFICIAL' },
    buyer: { country: 'DE', confidence: 'OFFICIAL' },
    classification: { buyerRole: 'B2B', crossBorder: true, supplyTypes: ['SERVICES'] },
    tax: {
      lines: [
        {
          lineId: 'L1',
          treatment: {
            components: [
              {
                taxSystem: 'VAT',
                name: 'VAT',
                category: 'AE',
                rate: 0,
                jurisdiction: 'DE',
                reason: 'VATEX-EU-AE',
              },
            ],
            buyerSelfAssess: true,
            reportingFlags: ['EC_SALES_LIST'],
            mentions: [],
          },
        },
      ],
      reportingFlags: ['EC_SALES_LIST'],
      mentions: [],
      buyerSelfAssess: true,
    },
    taxSystemKind: 'VAT',
    regime: { model: 'DECENTRALIZED_CTC', blocking: false },
    artifacts: [{ role: 'AUTHORITATIVE', syntax: 'EN16931_CII' }],
    channels: [{ type: 'PDP' }],
    numbering: { model: 'GAPLESS_SELF' },
    lifecycle: {
      immutableAfter: 'ISSUE',
      correctionModel: 'CREDIT_NOTE',
      cancellation: { allowed: true, requiresAuthorityAck: false },
    },
    archival: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'HASH_CHAIN' },
    reporting: ['EC_SALES_LIST'],
    confidence: 'OFFICIAL',
    warnings: [],
    ...overrides,
  } as unknown as CompliancePlan;
}

// ---------------------------------------------------------------------------
// Period tests
// ---------------------------------------------------------------------------

describe('getPeriodKey', () => {
  it.each<[string, ReportFrequency, string]>([
    ['2026-01-01', 'MONTHLY', '2026-01'],
    ['2026-06-15', 'MONTHLY', '2026-06'],
    ['2026-12-31', 'MONTHLY', '2026-12'],
    ['2026-01-15', 'QUARTERLY', '2026-Q1'],
    ['2026-04-01', 'QUARTERLY', '2026-Q2'],
    ['2026-07-31', 'QUARTERLY', '2026-Q3'],
    ['2026-10-01', 'QUARTERLY', '2026-Q4'],
  ])('date=%s freq=%s → %s', (dateStr, freq, expected) => {
    expect(getPeriodKey(new Date(dateStr), freq)).toBe(expected);
  });
});

describe('frequencyForKind', () => {
  it('OSS/IOSS/EC_SALES_LIST are quarterly', () => {
    expect(frequencyForKind('OSS')).toBe('QUARTERLY');
    expect(frequencyForKind('IOSS')).toBe('QUARTERLY');
    expect(frequencyForKind('EC_SALES_LIST')).toBe('QUARTERLY');
  });

  it('E_REPORTING/SAFT/INTRASTAT/SALES_PURCHASE_LEDGER/CUSTOMS_EXPORT are monthly', () => {
    expect(frequencyForKind('E_REPORTING')).toBe('MONTHLY');
    expect(frequencyForKind('SAFT')).toBe('MONTHLY');
    expect(frequencyForKind('INTRASTAT')).toBe('MONTHLY');
    expect(frequencyForKind('SALES_PURCHASE_LEDGER')).toBe('MONTHLY');
    expect(frequencyForKind('CUSTOMS_EXPORT')).toBe('MONTHLY');
  });
});

// ---------------------------------------------------------------------------
// E_REPORTING
// ---------------------------------------------------------------------------

describe('generateEReportingPayload', () => {
  it('produces a structured FR e-reporting payload', () => {
    const ctx = makeCtx({
      buyer: { legalName: 'Marie Dupont', countryCode: 'FR', role: 'B2C', identifiers: [] },
    });
    const plan = makePlan({
      classification: { buyerRole: 'B2C', crossBorder: false, supplyTypes: ['SERVICES'] },
      tax: {
        lines: [
          {
            lineId: 'L1',
            treatment: {
              components: [{ taxSystem: 'VAT', name: 'VAT', category: 'S', rate: 20, jurisdiction: 'FR' }],
              buyerSelfAssess: false,
              reportingFlags: [],
              mentions: [],
            },
          },
        ],
        reportingFlags: [],
        mentions: [],
        buyerSelfAssess: false,
      },
    });

    const payload = generateEReportingPayload(ctx, plan, '2026-06');

    expect(payload.periodKey).toBe('2026-06');
    expect(payload.transactionType).toBe('B2C_DOMESTIC');
    expect(payload.transactionDate).toBe('2026-06-15');
    expect(payload.documentRef).toBe('INV-2026-001');
    expect(payload.supplierVatId).toBe('FR12123456789');
    expect(payload.buyerCountry).toBe('FR');
    expect(payload.currency).toBe('EUR');
    expect(parseFloat(payload.netAmount)).toBeCloseTo(1000.0);
    expect(parseFloat(payload.vatAmount)).toBeCloseTo(200.0);
    expect(parseFloat(payload.grossAmount)).toBeCloseTo(1200.0);
    expect(payload.vatRate).toBe(20);
    expect(payload.vatCategory).toBe('S');
  });

  it('marks cross-border B2B as B2B_CROSS_BORDER', () => {
    const payload = generateEReportingPayload(makeCtx(), makePlan(), '2026-06');
    expect(payload.transactionType).toBe('B2B_CROSS_BORDER');
  });
});

// ---------------------------------------------------------------------------
// SAF-T
// ---------------------------------------------------------------------------

describe('generateSaftEntry', () => {
  it('produces well-formed OECD SAF-T XML', () => {
    const result = generateSaftEntry(makeCtx(), makePlan(), '2026-06');

    expect(result.xml).toContain('<?xml version="1.0"');
    expect(result.xml).toContain('AuditFile');
    expect(result.xml).toContain('SalesInvoices');
    expect(result.xml).toContain('<InvoiceNo>INV-2026-001</InvoiceNo>');
    expect(result.xml).toContain('<CustomerID>Client GmbH</CustomerID>');
    expect(result.xml).toContain('<InvoiceDate>2026-06-15</InvoiceDate>');
    expect(result.xml).toContain('<InvoiceType>FT</InvoiceType>');
    expect(result.xml).toContain('DocumentTotals');
    expect(result.xml).toContain('<NetTotal>1000.00</NetTotal>');
    expect(result.xml).toContain('<GrossTotal>1000.00</GrossTotal>'); // 0% VAT (AE)
  });

  it('sets InvoiceType NC for credit notes', () => {
    const ctx = makeCtx({ documentKind: 'CREDIT_NOTE' });
    const result = generateSaftEntry(ctx, makePlan(), '2026-06');
    expect(result.xml).toContain('<InvoiceType>NC</InvoiceType>');
  });

  it('meta matches the XML content', () => {
    const result = generateSaftEntry(makeCtx(), makePlan(), '2026-06');
    expect(result.meta.invoiceNo).toBe('INV-2026-001');
    expect(result.meta.invoiceDate).toBe('2026-06-15');
    expect(result.meta.customerName).toBe('Client GmbH');
    expect(result.meta.periodKey).toBe('2026-06');
    expect(result.meta.currency).toBe('EUR');
  });

  it('includes a Line entry for each ctx.lines entry', () => {
    const ctx = makeCtx({
      lines: [
        { id: 'L1', description: 'A', quantity: 1, unitNetMinor: 5000, supplyType: 'SERVICES' },
        { id: 'L2', description: 'B', quantity: 2, unitNetMinor: 2500, supplyType: 'GOODS' },
      ],
    });
    const plan = makePlan({
      tax: {
        lines: [
          {
            lineId: 'L1',
            treatment: {
              components: [{ taxSystem: 'VAT', name: 'VAT', category: 'S', rate: 20, jurisdiction: 'FR' }],
              buyerSelfAssess: false,
              reportingFlags: [],
              mentions: [],
            },
          },
          {
            lineId: 'L2',
            treatment: {
              components: [{ taxSystem: 'VAT', name: 'VAT', category: 'S', rate: 20, jurisdiction: 'FR' }],
              buyerSelfAssess: false,
              reportingFlags: [],
              mentions: [],
            },
          },
        ],
        reportingFlags: [],
        mentions: [],
        buyerSelfAssess: false,
      },
    });
    const result = generateSaftEntry(ctx, plan, '2026-06');
    expect((result.xml.match(/<Line>/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// OSS
// ---------------------------------------------------------------------------

describe('generateOssEntry', () => {
  it('produces a structured OSS entry for B2C cross-border services', () => {
    const ctx = makeCtx({
      buyer: { legalName: 'B2C Client', countryCode: 'IT', role: 'B2C', identifiers: [] },
    });
    const plan = makePlan({
      classification: { buyerRole: 'B2C', crossBorder: true, supplyTypes: ['DIGITAL'] },
      tax: {
        lines: [
          {
            lineId: 'L1',
            treatment: {
              components: [
                { taxSystem: 'VAT', name: 'VAT (OSS)', category: 'S', rate: 22, jurisdiction: 'IT' },
              ],
              buyerSelfAssess: false,
              reportingFlags: ['OSS'],
              mentions: [],
            },
          },
        ],
        reportingFlags: ['OSS'],
        mentions: [],
        buyerSelfAssess: false,
      },
    });

    const entry = generateOssEntry(ctx, plan, '2026-Q2');

    expect(entry.periodKey).toBe('2026-Q2');
    expect(entry.memberStateDest).toBe('IT');
    expect(entry.supplyType).toBe('DIGITAL_SERVICES');
    expect(entry.vatRate).toBe(22);
    expect(parseFloat(entry.netAmount)).toBeCloseTo(1000.0);
    expect(entry.currency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// IOSS
// ---------------------------------------------------------------------------

describe('generateIossEntry', () => {
  it('produces a structured IOSS entry', () => {
    const entry = generateIossEntry(makeCtx(), makePlan(), '2026-Q2');
    expect(entry.periodKey).toBe('2026-Q2');
    expect(entry.customerCountry).toBe('DE');
    expect(parseFloat(entry.goodsValue)).toBeCloseTo(1000.0);
    expect(entry.currency).toBe('EUR');
    expect(entry.documentRef).toBe('INV-2026-001');
  });
});

// ---------------------------------------------------------------------------
// EC_SALES_LIST
// ---------------------------------------------------------------------------

describe('generateEcSalesListEntry', () => {
  it('produces a structured ESL entry', () => {
    const entry = generateEcSalesListEntry(makeCtx(), makePlan(), '2026-Q2');
    expect(entry.periodKey).toBe('2026-Q2');
    expect(entry.buyerCountry).toBe('DE');
    expect(entry.buyerVatId).toBe('DE123456789');
    expect(entry.transactionType).toBe('SERVICES');
    expect(parseFloat(entry.netAmount)).toBeCloseTo(1000.0);
    expect(entry.documentRef).toBe('INV-2026-001');
  });

  it('reports GOODS type when supplyType contains GOODS', () => {
    const plan = makePlan({
      classification: { buyerRole: 'B2B', crossBorder: true, supplyTypes: ['GOODS'] },
    });
    const entry = generateEcSalesListEntry(makeCtx(), plan, '2026-Q2');
    expect(entry.transactionType).toBe('GOODS');
  });
});

// ---------------------------------------------------------------------------
// INTRASTAT
// ---------------------------------------------------------------------------

describe('generateIntrastatEntry', () => {
  it('produces a structured Intrastat entry as DISPATCH for K-category goods', () => {
    const plan = makePlan({
      tax: {
        lines: [
          {
            lineId: 'L1',
            treatment: {
              components: [
                {
                  taxSystem: 'VAT',
                  name: 'VAT',
                  category: 'K',
                  rate: 0,
                  jurisdiction: 'FR',
                  reason: 'VATEX-EU-IC',
                },
              ],
              buyerSelfAssess: false,
              reportingFlags: ['EC_SALES_LIST', 'INTRASTAT'],
              mentions: [],
            },
          },
        ],
        reportingFlags: ['EC_SALES_LIST', 'INTRASTAT'],
        mentions: [],
        buyerSelfAssess: false,
      },
    });
    const entry = generateIntrastatEntry(makeCtx(), plan, '2026-06');
    expect(entry.declarationType).toBe('DISPATCH');
    expect(entry.partnerCountry).toBe('DE');
    expect(parseFloat(entry.statisticalValue)).toBeCloseTo(1000.0);
    expect(entry.commodityCode).toBe(''); // enriched externally
  });
});

// ---------------------------------------------------------------------------
// SALES_PURCHASE_LEDGER
// ---------------------------------------------------------------------------

describe('generateSalesPurchaseLedgerEntry', () => {
  it('produces a full ledger entry', () => {
    const entry = generateSalesPurchaseLedgerEntry(makeCtx(), makePlan(), '2026-06');
    expect(entry.periodKey).toBe('2026-06');
    expect(entry.documentDate).toBe('2026-06-15');
    expect(entry.documentRef).toBe('INV-2026-001');
    expect(entry.buyerName).toBe('Client GmbH');
    expect(entry.buyerVatId).toBe('DE123456789');
    expect(parseFloat(entry.netAmount)).toBeCloseTo(1000.0);
    expect(entry.currency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// CUSTOMS_EXPORT
// ---------------------------------------------------------------------------

describe('generateCustomsExportPayload', () => {
  it('produces a customs export entry with ZERO_RATED_EXPORT for G-category', () => {
    const plan = makePlan({
      tax: {
        lines: [
          {
            lineId: 'L1',
            treatment: {
              components: [
                {
                  taxSystem: 'VAT',
                  name: 'VAT',
                  category: 'G',
                  rate: 0,
                  jurisdiction: 'FR',
                  reason: 'VATEX-EU-G',
                },
              ],
              buyerSelfAssess: false,
              reportingFlags: ['CUSTOMS_EXPORT'],
              mentions: [],
            },
          },
        ],
        reportingFlags: ['CUSTOMS_EXPORT'],
        mentions: [],
        buyerSelfAssess: false,
      },
    });
    const payload = generateCustomsExportPayload(makeCtx(), plan);
    expect(payload.exportBasis).toBe('ZERO_RATED_EXPORT');
    expect(payload.buyerCountry).toBe('DE');
    expect(payload.exporterVatId).toBe('FR12123456789');
    expect(parseFloat(payload.customsValue)).toBeCloseTo(1000.0);
    expect(payload.goodsDescription).toBe('Consulting services');
  });

  it('uses FREE_EXPORT for non-G categories', () => {
    const payload = generateCustomsExportPayload(makeCtx(), makePlan());
    expect(payload.exportBasis).toBe('FREE_EXPORT');
  });
});

// ---------------------------------------------------------------------------
// Spain (AEAT) fixtures — SII + Verifactu
// ---------------------------------------------------------------------------

function makeEsCtx(overrides: Partial<TransactionContext> = {}): TransactionContext {
  return {
    supplier: {
      legalName: 'Ibérica Soluciones SL',
      countryCode: 'ES',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'ESB12345674' }],
      address: { line1: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', countryCode: 'ES' },
    },
    buyer: {
      legalName: 'Cliente Español SL',
      countryCode: 'ES',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'ESA87654321' }],
    },
    lines: [
      {
        id: 'L1',
        description: 'Servicios de consultoría',
        quantity: 1,
        unitNetMinor: 100000,
        supplyType: 'SERVICES',
      },
    ],
    issueDate: new Date('2026-06-15T00:00:00Z'),
    currency: 'EUR',
    externalRef: 'FAC-2026-001',
    supplierCompanyId: 'company-es',
    ...overrides,
  } as TransactionContext;
}

function makeEsPlan(overrides: Partial<CompliancePlan> = {}): CompliancePlan {
  return {
    supplier: { country: 'ES', confidence: 'OFFICIAL' },
    buyer: { country: 'ES', confidence: 'OFFICIAL' },
    classification: { buyerRole: 'B2B', crossBorder: false, supplyTypes: ['SERVICES'] },
    tax: {
      lines: [
        {
          lineId: 'L1',
          treatment: {
            components: [{ taxSystem: 'VAT', name: 'IVA', category: 'S', rate: 21, jurisdiction: 'ES' }],
            buyerSelfAssess: false,
            reportingFlags: ['SII'],
            mentions: [],
          },
        },
      ],
      reportingFlags: ['SII'],
      mentions: [],
      buyerSelfAssess: false,
    },
    taxSystemKind: 'VAT',
    regime: { model: 'REAL_TIME_REPORTING', blocking: false },
    artifacts: [{ role: 'AUTHORITATIVE', syntax: 'ES_FACTURAE' }],
    channels: [{ type: 'GOV_PORTAL_API', providerId: 'es-aeat' }],
    numbering: { model: 'GAPLESS_SELF' },
    lifecycle: {
      immutableAfter: 'ISSUE',
      correctionModel: 'CREDIT_NOTE',
      cancellation: { allowed: true, requiresAuthorityAck: false },
    },
    archival: { retentionYears: 10, archivedForm: 'BOTH', integrity: 'SIGNED' },
    reporting: ['SII'],
    confidence: 'OFFICIAL',
    warnings: [],
    ...overrides,
  } as unknown as CompliancePlan;
}

// ---------------------------------------------------------------------------
// SII — AEAT SuministroLRFacturasEmitidas
// ---------------------------------------------------------------------------

describe('generateSiiRegistroPayload', () => {
  it('produces a well-formed SuministroLR XML with the real AEAT element/namespace names', () => {
    const result = generateSiiRegistroPayload(makeEsCtx(), makeEsPlan(), '2026-06');

    // Root element + namespace URIs verified against the official SuministroLR.xsd /
    // SuministroInformacion.xsd targetNamespace declarations (sede.agenciatributaria.gob.es).
    expect(result.xml).toContain('<siiLR:SuministroLRFacturasEmitidas');
    expect(result.xml).toContain(
      'xmlns:sii="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroInformacion.xsd"',
    );
    expect(result.xml).toContain(
      'xmlns:siiLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroLR.xsd"',
    );

    // Cabecera (sii:CabeceraSii)
    expect(result.xml).toContain('<sii:IDVersionSii>1.1</sii:IDVersionSii>');
    expect(result.xml).toContain('<sii:NombreRazon>Ibérica Soluciones SL</sii:NombreRazon>');
    expect(result.xml).toContain('<sii:NIF>B12345674</sii:NIF>');
    expect(result.xml).toContain('<sii:TipoComunicacion>A0</sii:TipoComunicacion>');

    // RegistroLRFacturasEmitidas → PeriodoLiquidacion / IDFactura / FacturaExpedida
    expect(result.xml).toContain('<siiLR:RegistroLRFacturasEmitidas>');
    expect(result.xml).toContain('<sii:Ejercicio>2026</sii:Ejercicio>');
    expect(result.xml).toContain('<sii:Periodo>06</sii:Periodo>');
    expect(result.xml).toContain('<sii:NumSerieFacturaEmisor>FAC-2026-001</sii:NumSerieFacturaEmisor>');
    expect(result.xml).toContain(
      '<sii:FechaExpedicionFacturaEmisor>15-06-2026</sii:FechaExpedicionFacturaEmisor>',
    );
    expect(result.xml).toContain('<sii:TipoFactura>F1</sii:TipoFactura>');
    expect(result.xml).toContain(
      '<sii:ClaveRegimenEspecialOTrascendencia>01</sii:ClaveRegimenEspecialOTrascendencia>',
    );
    expect(result.xml).toContain('<sii:ImporteTotal>1210.00</sii:ImporteTotal>');
    expect(result.xml).toContain('<sii:Contraparte>');

    // TipoDesglose → DesgloseFactura (TipoSinDesgloseType) → Sujeta → NoExenta → DesgloseIVA → DetalleIVA
    expect(result.xml).toContain('<sii:TipoDesglose>');
    expect(result.xml).toContain('<sii:DesgloseFactura>');
    expect(result.xml).toContain('<sii:Sujeta>');
    expect(result.xml).toContain('<sii:NoExenta>');
    expect(result.xml).toContain('<sii:TipoNoExenta>S1</sii:TipoNoExenta>');
    expect(result.xml).toContain('<sii:DesgloseIVA>');
    expect(result.xml).toContain('<sii:DetalleIVA>');
    expect(result.xml).toContain('<sii:TipoImpositivo>21</sii:TipoImpositivo>');
    expect(result.xml).toContain('<sii:BaseImponible>1000.00</sii:BaseImponible>');
    expect(result.xml).toContain('<sii:CuotaRepercutida>210.00</sii:CuotaRepercutida>');
  });

  it('structured meta mirrors the XML content', () => {
    const result = generateSiiRegistroPayload(makeEsCtx(), makeEsPlan(), '2026-06');
    expect(result.meta.periodKey).toBe('2026-06');
    expect(result.meta.ejercicio).toBe('2026');
    expect(result.meta.periodo).toBe('06');
    expect(result.meta.nifEmisor).toBe('B12345674');
    expect(result.meta.numSerieFactura).toBe('FAC-2026-001');
    expect(result.meta.fechaExpedicion).toBe('15-06-2026');
    expect(result.meta.tipoFactura).toBe('F1');
    expect(result.meta.importeTotal).toBe('1210.00');
    expect(result.meta.cuotaTotal).toBe('210.00');
  });

  it('uses TipoFactura=R1 for credit notes', () => {
    const ctx = makeEsCtx({ documentKind: 'CREDIT_NOTE' });
    const result = generateSiiRegistroPayload(ctx, makeEsPlan(), '2026-06');
    expect(result.xml).toContain('<sii:TipoFactura>R1</sii:TipoFactura>');
  });

  it('uses Contraparte/IDOtro (not NIF) for a non-Spanish buyer', () => {
    const ctx = makeEsCtx({
      buyer: {
        legalName: 'Client France SARL',
        countryCode: 'FR',
        role: 'B2B',
        identifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
      },
    });
    const result = generateSiiRegistroPayload(ctx, makeEsPlan(), '2026-06');
    expect(result.xml).toContain('<sii:IDOtro>');
    expect(result.xml).toContain('<sii:CodigoPais>FR</sii:CodigoPais>');
    expect(result.xml).toContain('<sii:IDType>02</sii:IDType>');
    expect(result.xml).toContain('<sii:ID>FR12345678901</sii:ID>');
  });
});

// ---------------------------------------------------------------------------
// VERIFACTU — AEAT hash-chain RegistroAlta (Huella) + QR
// ---------------------------------------------------------------------------

describe('generateVerifactuRegistroPayload', () => {
  it('huella algorithm matches the official AEAT worked example — case 1 (first record, no chain)', () => {
    // Verbatim from "Detalle de las especificaciones técnicas para la generación de la huella o
    // hash de los registros de facturación" v0.1.2 (27/08/2024, AEAT), §6.1 "Caso 1". This proves
    // the documented canonical-string field set/order/casing against AEAT's own published vector,
    // independently of our generator implementation.
    const canonical =
      'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024' +
      '&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00';
    const huella = createHash('sha256').update(Buffer.from(canonical, 'utf-8')).digest('hex').toUpperCase();
    expect(huella).toBe('3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60');
  });

  it('huella algorithm matches the official AEAT worked example — case 2 (chained record)', () => {
    // §6.2 "Caso 2" of the same document: second record, chaining case-1's huella.
    const canonical =
      'IDEmisorFactura=89890001K&NumSerieFactura=12345679/G34&FechaExpedicionFactura=01-01-2024' +
      '&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45' +
      '&Huella=3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60' +
      '&FechaHoraHusoGenRegistro=2024-01-01T19:20:35+01:00';
    const huella = createHash('sha256').update(Buffer.from(canonical, 'utf-8')).digest('hex').toUpperCase();
    expect(huella).toBe('F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97');
  });

  it('generator huella is reproducible: independently recomputing SHA-256 over the documented canonical string (built from the returned fields, not the generator internals) equals the returned huella', () => {
    const result = generateVerifactuRegistroPayload(makeEsCtx(), makeEsPlan(), '2026-06');
    const r = result.registro;
    const independentCanonical =
      `IDEmisorFactura=${r.idEmisorFactura}&NumSerieFactura=${r.numSerieFactura}` +
      `&FechaExpedicionFactura=${r.fechaExpedicionFactura}&TipoFactura=${r.tipoFactura}` +
      `&CuotaTotal=${r.cuotaTotal}&ImporteTotal=${r.importeTotal}&Huella=${result.previousHuella}` +
      `&FechaHoraHusoGenRegistro=${r.fechaHoraHusoGenRegistro}`;
    const independentHuella = createHash('sha256')
      .update(Buffer.from(independentCanonical, 'utf-8'))
      .digest('hex')
      .toUpperCase();
    expect(result.huella).toBe(independentHuella);
    expect(result.huella).toMatch(/^[0-9A-F]{64}$/);
  });

  it('first record: previousHuella defaults to "" and primerRegistro is true', () => {
    const result = generateVerifactuRegistroPayload(makeEsCtx(), makeEsPlan(), '2026-06');
    expect(result.previousHuella).toBe('');
    expect(result.primerRegistro).toBe(true);
  });

  it('chaining: feeding record N huella as previousHuella for N+1 changes N+1 huella and is embedded in its canonical input', () => {
    const ctx = makeEsCtx();
    const plan = makeEsPlan();
    const record1 = generateVerifactuRegistroPayload(ctx, plan, '2026-06');
    const record2 = generateVerifactuRegistroPayload(ctx, plan, '2026-06', record1.huella);

    expect(record2.previousHuella).toBe(record1.huella);
    expect(record2.primerRegistro).toBe(false);
    expect(record2.huella).not.toBe(record1.huella);

    // Prove the chained huella actually changes record2's hash (it is embedded in the hashed
    // input, not just carried through as inert metadata).
    const r = record2.registro;
    const canonicalWithoutChain =
      `IDEmisorFactura=${r.idEmisorFactura}&NumSerieFactura=${r.numSerieFactura}` +
      `&FechaExpedicionFactura=${r.fechaExpedicionFactura}&TipoFactura=${r.tipoFactura}` +
      `&CuotaTotal=${r.cuotaTotal}&ImporteTotal=${r.importeTotal}&Huella=` +
      `&FechaHoraHusoGenRegistro=${r.fechaHoraHusoGenRegistro}`;
    const huellaWithoutChain = createHash('sha256')
      .update(Buffer.from(canonicalWithoutChain, 'utf-8'))
      .digest('hex')
      .toUpperCase();
    expect(record2.huella).not.toBe(huellaWithoutChain);
  });

  /**
   * ES-D12: this assertion previously pinned `…/ValidarQR`, the path for a system emitting
   * VERIFIABLE invoices. The expectation itself was wrong, not merely outdated: AEAT's QR spec
   * (v0.5.0, 2025-12-10) §5.1/§5.2 gives a different PATH per system mode, and this product
   * transmits nothing to AEAT, so it is a non-verifiable system. The old URL told the recipient's
   * scanner to check a record stream AEAT never received. Updated, not deleted — and the mode is
   * now asserted explicitly below so a silent flip back is a test failure.
   */
  it('QR content is a well-formed AEAT ValidarQRNoVerifactu URL with the 4 required params, URL-encoded', () => {
    const ctx = makeEsCtx({ externalRef: '12345678&G33' });
    const result = generateVerifactuRegistroPayload(ctx, makeEsPlan(), '2026-06');
    expect(
      result.qrContent.startsWith(
        'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu?',
      ),
    ).toBe(true);
    // The verifiable-system path must NOT appear: `ValidarQR?` is a prefix of neither URL once the
    // query starts, so this pins the mode rather than merely the host.
    expect(result.qrContent).not.toContain('/ValidarQR?');
    expect(result.qrContent).toContain('nif=B12345674');
    // '&' must be percent-encoded inside numserie — verified against the official QR spec worked
    // example (encoding "12345678&G33" → "12345678%26G33").
    expect(result.qrContent).toContain('numserie=12345678%26G33');
    expect(result.qrContent).toContain('fecha=15-06-2026');
    expect(result.qrContent).toContain('importe=1210.00');
  });

  it('exposes both QR axes — mode chooses the path, environment chooses the host', () => {
    // AEAT QR spec v0.5.0 §5.1/§5.2. The regression this pins: treating the difference as
    // environment-only, which is what the previous code comment claimed. Swapping the host while
    // staying on the verifiable path is exactly the mistake ES-D12 describes.
    expect(verifactuQrBase('NON_VERIFIABLE', 'PRODUCTION')).toBe(
      'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu',
    );
    expect(verifactuQrBase('NON_VERIFIABLE', 'TEST')).toBe(
      'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu',
    );
    expect(verifactuQrBase('VERIFIABLE', 'PRODUCTION')).toBe(
      'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
    );
    expect(verifactuQrBase('VERIFIABLE', 'TEST')).toBe('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR');
    // The default is the product's actual mode: it transmits nothing, so it is non-verifiable.
    expect(verifactuQrBase()).toBe(verifactuQrBase('NON_VERIFIABLE', 'PRODUCTION'));
  });

  it('meta reflects the transaction', () => {
    const result = generateVerifactuRegistroPayload(makeEsCtx(), makeEsPlan(), '2026-06');
    expect(result.meta.periodKey).toBe('2026-06');
    expect(result.meta.invoiceNo).toBe('FAC-2026-001');
    expect(result.meta.buyerName).toBe('Cliente Español SL');
    expect(result.meta.currency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// ES wiring — SiiReportingHandler / VerifactuReportingHandler resolve and emit real payloads
// ---------------------------------------------------------------------------

describe('ES reporting handlers (SII / VERIFACTU) end to end', () => {
  it('SiiReportingHandler resolves via the registry and emits a real SuministroLR payload', async () => {
    const { defaultReportingRegistry } = await import('./registry.js');
    const { RecordingComplianceLogger } = await import('../execution/logger.js');

    const handler = defaultReportingRegistry.get('SII');
    expect(handler?.kind).toBe('SII');

    const log = new RecordingComplianceLogger();
    const result = await handler!.report(makeEsCtx(), makeEsPlan({ reporting: ['SII'] }), log);
    expect(result.status).toBe('EMITTED');
    expect(result.kind).toBe('SII');
  });

  it('VerifactuReportingHandler resolves via the registry and emits a real RegistroAlta payload', async () => {
    const { defaultReportingRegistry } = await import('./registry.js');
    const { RecordingComplianceLogger } = await import('../execution/logger.js');

    const handler = defaultReportingRegistry.get('VERIFACTU');
    expect(handler?.kind).toBe('VERIFACTU');

    const log = new RecordingComplianceLogger();
    const result = await handler!.report(makeEsCtx(), makeEsPlan({ reporting: ['VERIFACTU'] }), log);
    expect(result.status).toBe('EMITTED');
    expect(result.kind).toBe('VERIFACTU');
  });

  it('registry.reportAll for an ES-shaped plan emits both SII and VERIFACTU when both are requested', async () => {
    const { ReportingRegistry } = await import('./registry.js');
    const { NullReportingStore } = await import('./reporting-store.js');
    const { RecordingComplianceLogger } = await import('../execution/logger.js');

    const registry = new ReportingRegistry(undefined, new NullReportingStore());
    const log = new RecordingComplianceLogger();
    const results = await registry.reportAll(
      makeEsCtx(),
      makeEsPlan({ reporting: ['SII', 'VERIFACTU'] }),
      log,
    );
    expect(results.map((r) => r.kind)).toEqual(['SII', 'VERIFACTU']);
    expect(results.every((r) => r.status === 'EMITTED')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

describe('Idempotence via NullReportingStore in handlers', () => {
  it('second call returns SKIPPED when store already has record', async () => {
    const { EReportingReportingHandler } = await import('./handlers.js');
    const { RecordingComplianceLogger } = await import('../execution/logger.js');

    const existingRecord = {
      id: 'already-filed',
      status: 'PENDING',
      kind: 'E_REPORTING',
      periodKey: '2026-06',
      companyId: 'company-abc',
      invoiceRef: 'INV-2026-001',
      payload: {},
      submittedRef: null,
      submittedAt: null,
      createdAt: new Date(),
    };

    const mockStore = {
      find: jest.fn().mockResolvedValue(existingRecord),
      create: jest.fn(),
      markSubmitted: jest.fn(),
    };

    const handler = new EReportingReportingHandler(mockStore as any);
    const ctx = makeCtx();
    const plan = makePlan({ reporting: ['E_REPORTING'] });
    const log = new RecordingComplianceLogger();

    const result = await handler.report(ctx, plan, log);

    expect(result.status).toBe('SKIPPED');
    expect(result.ref).toBe('already-filed');
    expect(mockStore.create).not.toHaveBeenCalled();
  });

  it('first call creates record and returns EMITTED', async () => {
    const { EReportingReportingHandler } = await import('./handlers.js');
    const { RecordingComplianceLogger } = await import('../execution/logger.js');

    const createdRecord = {
      id: 'new-record',
      status: 'PENDING',
      kind: 'E_REPORTING',
      periodKey: '2026-06',
      companyId: 'company-abc',
      invoiceRef: 'INV-2026-001',
      payload: {},
      submittedRef: null,
      submittedAt: null,
      createdAt: new Date(),
    };

    const mockStore = {
      find: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(createdRecord),
      markSubmitted: jest.fn(),
    };

    const handler = new EReportingReportingHandler(mockStore as any);
    const ctx = makeCtx();
    const plan = makePlan({ reporting: ['E_REPORTING'] });
    const log = new RecordingComplianceLogger();

    const result = await handler.report(ctx, plan, log);

    expect(result.status).toBe('EMITTED');
    expect(result.ref).toBe('new-record');
    expect(mockStore.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * F-016 — a mocked submission must be detectable from the return value, not only from a log line.
 */
describe('F-016: reporting results declare that the submission is mocked', () => {
  it('a handler that generated and stored a payload but submitted nothing returns mocked: true', async () => {
    const { VerifactuReportingHandler } = require('./handlers');
    const handler = new VerifactuReportingHandler();
    const { RecordingComplianceLogger } = require('../execution/logger');
    const ctx = {
      supplier: { legalName: 'ES Co', countryCode: 'ES', role: 'B2B', identifiers: [] },
      buyer: { legalName: 'ES Buyer', countryCode: 'ES', role: 'B2B', identifiers: [] },
      lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
      issueDate: new Date('2026-10-01'),
      currency: 'EUR',
    };
    const { resolve } = require('../engine/compliance-engine');
    const result = await handler.report(ctx, resolve(ctx), new RecordingComplianceLogger());

    // EMITTED alone said nothing about whether anything was filed.
    expect(result.status).toBe('EMITTED');
    expect(result.mocked).toBe(true);
  });
});
