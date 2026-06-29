/**
 * §6 — Reporting period-close cron tests.
 *
 * Covers:
 *  - isPeriodClosed: monthly and quarterly period key logic with injected clock
 *  - Idempotence: second run on already-SUBMITTED records is a no-op
 *  - Period-due: only closed-period PENDING records are submitted
 */
import { getPeriodKey, frequencyForKind } from './period';
import { ReportRecord, ReportingStore } from './reporting-store';
import { ReportingKind } from '../types';

// ---------------------------------------------------------------------------
// Pure helper: period closed/open logic (mirrors ComplianceCron.isPeriodClosed)
// ---------------------------------------------------------------------------

function isPeriodClosed(kind: ReportingKind, periodKey: string, now: Date): boolean {
  const freq = frequencyForKind(kind);
  const currentPeriod = getPeriodKey(now, freq);
  return periodKey < currentPeriod;
}

// ---------------------------------------------------------------------------
// isPeriodClosed tests
// ---------------------------------------------------------------------------

describe('isPeriodClosed (period-close logic)', () => {
  const NOW = new Date('2026-06-29T10:00:00Z'); // June 2026 = 2026-Q2

  describe('monthly kinds', () => {
    const monthlyKinds: ReportingKind[] = ['E_REPORTING', 'INTRASTAT', 'SALES_PURCHASE_LEDGER', 'CUSTOMS_EXPORT', 'SAFT'];

    it.each(monthlyKinds)('%s — 2026-05 is closed (before current June)', (kind) => {
      expect(isPeriodClosed(kind, '2026-05', NOW)).toBe(true);
    });

    it.each(monthlyKinds)('%s — 2026-06 is NOT closed (current month)', (kind) => {
      expect(isPeriodClosed(kind, '2026-06', NOW)).toBe(false);
    });

    it.each(monthlyKinds)('%s — 2026-07 is NOT closed (future month)', (kind) => {
      expect(isPeriodClosed(kind, '2026-07', NOW)).toBe(false);
    });

    it.each(monthlyKinds)('%s — 2025-12 is closed (last year December)', (kind) => {
      expect(isPeriodClosed(kind, '2025-12', NOW)).toBe(true);
    });
  });

  describe('quarterly kinds', () => {
    const quarterlyKinds: ReportingKind[] = ['OSS', 'IOSS', 'EC_SALES_LIST'];

    it.each(quarterlyKinds)('%s — 2026-Q1 is closed (before Q2)', (kind) => {
      expect(isPeriodClosed(kind, '2026-Q1', NOW)).toBe(true);
    });

    it.each(quarterlyKinds)('%s — 2026-Q2 is NOT closed (current quarter)', (kind) => {
      expect(isPeriodClosed(kind, '2026-Q2', NOW)).toBe(false);
    });

    it.each(quarterlyKinds)('%s — 2026-Q3 is NOT closed (future quarter)', (kind) => {
      expect(isPeriodClosed(kind, '2026-Q3', NOW)).toBe(false);
    });

    it.each(quarterlyKinds)('%s — 2025-Q4 is closed (last year)', (kind) => {
      expect(isPeriodClosed(kind, '2025-Q4', NOW)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// In-memory tracking store for period-close idempotence tests
// ---------------------------------------------------------------------------

class TrackingStore implements ReportingStore {
  readonly submittedIds: string[] = [];
  private readonly records: ReportRecord[] = [];

  addPending(record: Omit<ReportRecord, 'id' | 'createdAt'>): void {
    this.records.push({ ...record, id: `rec-${this.records.length}`, createdAt: new Date() });
  }

  async find(
    kind: string,
    periodKey: string,
    companyId: string | null,
    invoiceRef: string | null,
  ): Promise<ReportRecord | null> {
    return (
      this.records.find(
        (r) =>
          r.kind === kind &&
          r.periodKey === periodKey &&
          r.companyId === companyId &&
          r.invoiceRef === invoiceRef,
      ) ?? null
    );
  }

  async create(record: Omit<ReportRecord, 'id' | 'createdAt'>): Promise<ReportRecord> {
    const row: ReportRecord = { ...record, id: `rec-${this.records.length}`, createdAt: new Date() };
    this.records.push(row);
    return row;
  }

  async markSubmitted(id: string, ref: string, submittedAt: Date = new Date()): Promise<void> {
    this.submittedIds.push(id);
    const rec = this.records.find((r) => r.id === id);
    if (rec) {
      rec.status = 'SUBMITTED';
      rec.submittedRef = ref;
      rec.submittedAt = submittedAt;
    }
  }

  async findPendingForClosedPeriods(now: Date): Promise<ReportRecord[]> {
    return this.records.filter((r) => {
      if (r.status !== 'PENDING') return false;
      return isPeriodClosed(r.kind as ReportingKind, r.periodKey, now);
    });
  }
}

// Simulate what the cron tick does (without the lock / logger overhead).
async function runReportingClose(store: ReportingStore & { findPendingForClosedPeriods: (n: Date) => Promise<ReportRecord[]> }, now: Date): Promise<number> {
  const pending = await store.findPendingForClosedPeriods(now);
  for (const record of pending) {
    const mockRef = `mock:${record.kind}:${record.periodKey}:${record.id}`;
    await store.markSubmitted(record.id, mockRef, now);
  }
  return pending.length;
}

// ---------------------------------------------------------------------------
// Idempotence tests
// ---------------------------------------------------------------------------

describe('Reporting period-close — idempotence', () => {
  const NOW = new Date('2026-06-29T02:00:00Z');

  it('second run is a no-op when records are already SUBMITTED', async () => {
    const store = new TrackingStore();
    store.addPending({
      kind: 'E_REPORTING',
      periodKey: '2026-05', // closed
      companyId: 'comp-1',
      invoiceRef: 'inv-1',
      status: 'PENDING',
      payload: {},
      submittedRef: null,
      submittedAt: null,
    });

    const firstRun = await runReportingClose(store, NOW);
    expect(firstRun).toBe(1);
    expect(store.submittedIds).toHaveLength(1);

    const secondRun = await runReportingClose(store, NOW);
    expect(secondRun).toBe(0); // no-op: record is SUBMITTED, not in pending
    expect(store.submittedIds).toHaveLength(1); // unchanged
  });

  it('only submits closed-period records; current-period records stay PENDING', async () => {
    const store = new TrackingStore();
    // Closed period (May)
    store.addPending({
      kind: 'SAFT',
      periodKey: '2026-05',
      companyId: 'comp-1',
      invoiceRef: 'inv-1',
      status: 'PENDING',
      payload: {},
      submittedRef: null,
      submittedAt: null,
    });
    // Current period (June) — should NOT be submitted
    store.addPending({
      kind: 'SAFT',
      periodKey: '2026-06',
      companyId: 'comp-1',
      invoiceRef: 'inv-2',
      status: 'PENDING',
      payload: {},
      submittedRef: null,
      submittedAt: null,
    });

    const submitted = await runReportingClose(store, NOW);
    expect(submitted).toBe(1); // only May was submitted
    expect(store.submittedIds).toHaveLength(1);
  });

  it('processes multiple kinds, companies, and periods in one run', async () => {
    const store = new TrackingStore();
    const closed: Array<Omit<ReportRecord, 'id' | 'createdAt'>> = [
      { kind: 'E_REPORTING', periodKey: '2026-05', companyId: 'a', invoiceRef: '1', status: 'PENDING', payload: {}, submittedRef: null, submittedAt: null },
      { kind: 'E_REPORTING', periodKey: '2026-04', companyId: 'a', invoiceRef: '2', status: 'PENDING', payload: {}, submittedRef: null, submittedAt: null },
      { kind: 'OSS',         periodKey: '2026-Q1', companyId: 'b', invoiceRef: '3', status: 'PENDING', payload: {}, submittedRef: null, submittedAt: null },
    ];
    for (const r of closed) store.addPending(r);

    const submitted = await runReportingClose(store, NOW);
    expect(submitted).toBe(3);
    expect(store.submittedIds).toHaveLength(3);
  });

  it('quarterly record 2026-Q1 is submitted but 2026-Q2 is not', async () => {
    const store = new TrackingStore();
    store.addPending({ kind: 'OSS', periodKey: '2026-Q1', companyId: 'c', invoiceRef: '1', status: 'PENDING', payload: {}, submittedRef: null, submittedAt: null });
    store.addPending({ kind: 'OSS', periodKey: '2026-Q2', companyId: 'c', invoiceRef: '2', status: 'PENDING', payload: {}, submittedRef: null, submittedAt: null });

    const submitted = await runReportingClose(store, NOW);
    expect(submitted).toBe(1);
    // Q1 should be submitted
    const q1 = store['records'].find((r: ReportRecord) => r.periodKey === '2026-Q1');
    expect(q1?.status).toBe('SUBMITTED');
    // Q2 stays PENDING
    const q2 = store['records'].find((r: ReportRecord) => r.periodKey === '2026-Q2');
    expect(q2?.status).toBe('PENDING');
  });
});
