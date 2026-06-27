import { CompliancePlan } from '../engine/compliance-engine';
import { RecordingComplianceLogger } from '../execution/logger';
import { ReportingKind } from '../types';
import { defaultReportingRegistry } from './registry';

const planWith = (reporting: ReportingKind[]) => ({ reporting } as unknown as CompliancePlan);

describe('ReportingRegistry', () => {
  it('has a handler for every reporting kind', () => {
    for (const k of ['EC_SALES_LIST', 'INTRASTAT', 'OSS', 'IOSS', 'SAFT', 'E_REPORTING', 'SALES_PURCHASE_LEDGER', 'CUSTOMS_EXPORT'] as ReportingKind[]) {
      expect(defaultReportingRegistry.get(k)?.kind).toBe(k);
    }
  });

  it('reportAll queues each plan.reporting kind, preserving order', () => {
    const log = new RecordingComplianceLogger();
    const results = defaultReportingRegistry.reportAll({} as never, planWith(['EC_SALES_LIST', 'OSS', 'CUSTOMS_EXPORT']), log);
    expect(results.map((r) => r.kind)).toEqual(['EC_SALES_LIST', 'OSS', 'CUSTOMS_EXPORT']);
    expect(results.every((r) => r.status === 'QUEUED')).toBe(true);
  });

  it('skips an unknown reporting kind with a warning', () => {
    const log = new RecordingComplianceLogger();
    const results = defaultReportingRegistry.reportAll({} as never, planWith(['NOPE' as ReportingKind]), log);
    expect(results[0].status).toBe('SKIPPED');
  });

  it('an empty reporting list produces no results', () => {
    expect(defaultReportingRegistry.reportAll({} as never, planWith([]), new RecordingComplianceLogger())).toEqual([]);
  });
});
