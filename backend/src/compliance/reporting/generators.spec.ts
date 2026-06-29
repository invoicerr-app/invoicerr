/**
 * Tests for the pure reporting generators and period/scheduling utilities.
 *
 * All generators receive synthetic TransactionContext + CompliancePlan stubs — no I/O, fully pure.
 */
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
      { id: 'L1', description: 'Consulting services', quantity: 10, unitNetMinor: 10000, supplyType: 'SERVICES' },
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
            components: [{ taxSystem: 'VAT', name: 'VAT', category: 'AE', rate: 0, jurisdiction: 'DE', reason: 'VATEX-EU-AE' }],
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
    lifecycle: { immutableAfter: 'ISSUE', correctionModel: 'CREDIT_NOTE', cancellation: { allowed: true, requiresAuthorityAck: false } },
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
    const ctx = makeCtx({ buyer: { legalName: 'Marie Dupont', countryCode: 'FR', role: 'B2C', identifiers: [] } });
    const plan = makePlan({
      classification: { buyerRole: 'B2C', crossBorder: false, supplyTypes: ['SERVICES'] },
      tax: {
        lines: [{ lineId: 'L1', treatment: { components: [{ taxSystem: 'VAT', name: 'VAT', category: 'S', rate: 20, jurisdiction: 'FR' }], buyerSelfAssess: false, reportingFlags: [], mentions: [] } }],
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
          { lineId: 'L1', treatment: { components: [{ taxSystem: 'VAT', name: 'VAT', category: 'S', rate: 20, jurisdiction: 'FR' }], buyerSelfAssess: false, reportingFlags: [], mentions: [] } },
          { lineId: 'L2', treatment: { components: [{ taxSystem: 'VAT', name: 'VAT', category: 'S', rate: 20, jurisdiction: 'FR' }], buyerSelfAssess: false, reportingFlags: [], mentions: [] } },
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
    const ctx = makeCtx({ buyer: { legalName: 'B2C Client', countryCode: 'IT', role: 'B2C', identifiers: [] } });
    const plan = makePlan({
      classification: { buyerRole: 'B2C', crossBorder: true, supplyTypes: ['DIGITAL'] },
      tax: {
        lines: [{ lineId: 'L1', treatment: { components: [{ taxSystem: 'VAT', name: 'VAT (OSS)', category: 'S', rate: 22, jurisdiction: 'IT' }], buyerSelfAssess: false, reportingFlags: ['OSS'], mentions: [] } }],
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
    const plan = makePlan({ classification: { buyerRole: 'B2B', crossBorder: true, supplyTypes: ['GOODS'] } });
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
        lines: [{ lineId: 'L1', treatment: { components: [{ taxSystem: 'VAT', name: 'VAT', category: 'K', rate: 0, jurisdiction: 'FR', reason: 'VATEX-EU-IC' }], buyerSelfAssess: false, reportingFlags: ['EC_SALES_LIST', 'INTRASTAT'], mentions: [] } }],
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
        lines: [{ lineId: 'L1', treatment: { components: [{ taxSystem: 'VAT', name: 'VAT', category: 'G', rate: 0, jurisdiction: 'FR', reason: 'VATEX-EU-G' }], buyerSelfAssess: false, reportingFlags: ['CUSTOMS_EXPORT'], mentions: [] } }],
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
// Idempotence
// ---------------------------------------------------------------------------

describe('Idempotence via NullReportingStore in handlers', () => {
  it('second call returns SKIPPED when store already has record', async () => {
    const { EReportingReportingHandler } = await import('./handlers');
    const { RecordingComplianceLogger } = await import('../execution/logger');

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
    const { EReportingReportingHandler } = await import('./handlers');
    const { RecordingComplianceLogger } = await import('../execution/logger');

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
