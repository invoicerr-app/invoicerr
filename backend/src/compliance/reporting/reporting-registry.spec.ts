import { CompliancePlan } from '../engine/compliance-engine';
import { RecordingComplianceLogger } from '../execution/logger';
import { ReportingKind } from '../types';
import { defaultReportingRegistry, ReportingRegistry } from './registry';
import { NullReportingStore } from './reporting-store';

const planWith = (reporting: ReportingKind[]) => ({ reporting, tax: { lines: [], reportingFlags: [], mentions: [], buyerSelfAssess: false }, classification: { buyerRole: 'B2B', crossBorder: false, supplyTypes: ['SERVICES'] } } as unknown as CompliancePlan);

const ctxStub = {
  supplier: { legalName: 'ACME', countryCode: 'FR', role: 'B2B' as const, identifiers: [] },
  buyer: { legalName: 'Client', countryCode: 'FR', role: 'B2B' as const, identifiers: [] },
  lines: [],
  issueDate: new Date('2026-06-15'),
  currency: 'EUR',
} as any;

describe('ReportingRegistry', () => {
  it('has a handler for every reporting kind', () => {
    for (const k of ['EC_SALES_LIST', 'INTRASTAT', 'OSS', 'IOSS', 'SAFT', 'E_REPORTING', 'SALES_PURCHASE_LEDGER', 'CUSTOMS_EXPORT'] as ReportingKind[]) {
      expect(defaultReportingRegistry.get(k)?.kind).toBe(k);
    }
  });

  it('reportAll emits each plan.reporting kind, preserving order', async () => {
    const registry = new ReportingRegistry(undefined, new NullReportingStore());
    const log = new RecordingComplianceLogger();
    const results = await registry.reportAll(ctxStub, planWith(['EC_SALES_LIST', 'OSS', 'CUSTOMS_EXPORT']), log);
    expect(results.map((r) => r.kind)).toEqual(['EC_SALES_LIST', 'OSS', 'CUSTOMS_EXPORT']);
    expect(results.every((r) => r.status === 'EMITTED')).toBe(true);
  });

  it('skips an unknown reporting kind with a warning', async () => {
    const registry = new ReportingRegistry(undefined, new NullReportingStore());
    const log = new RecordingComplianceLogger();
    const results = await registry.reportAll(ctxStub, planWith(['NOPE' as ReportingKind]), log);
    expect(results[0].status).toBe('SKIPPED');
  });

  it('an empty reporting list produces no results', async () => {
    const registry = new ReportingRegistry(undefined, new NullReportingStore());
    expect(await registry.reportAll(ctxStub, planWith([]), new RecordingComplianceLogger())).toEqual([]);
  });

  it('returns SKIPPED (idempotent) when the store already has a record', async () => {
    const existingId = 'existing-record-id';
    const mockStore = {
      find: jest.fn().mockResolvedValue({ id: existingId, status: 'PENDING' }),
      create: jest.fn(),
      markSubmitted: jest.fn(),
    };
    const registry = new ReportingRegistry(undefined, mockStore as any);
    const log = new RecordingComplianceLogger();
    const results = await registry.reportAll(ctxStub, planWith(['E_REPORTING']), log);
    expect(results[0].status).toBe('SKIPPED');
    expect(results[0].ref).toBe(existingId);
    expect(mockStore.create).not.toHaveBeenCalled();
  });
});
