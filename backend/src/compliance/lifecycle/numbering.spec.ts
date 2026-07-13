/**
 * Numbering + AUTHORITY_RANGE wiring (F-9 — COMPLIANCE_AUDIT.md). Before this fix, `FolioPool.loadRange()`
 * had no caller anywhere in the codebase, so AUTHORITY_RANGE countries (MX/CL) could never actually
 * be numbered. These tests cover the fix directly at the numbering-layer level (the
 * ComplianceService-level hard-block behavior is covered separately in operations/compliance-service.spec.ts).
 */
import { RecordingComplianceLogger } from '../execution/logger';
import {
  ConfigAuthorityRangeSource,
  hydrateAuthorityRange,
  NullAuthorityRangeSource,
} from './authority-range-source';
import { FolioPool, GaplessSelfNumberer, NumberingRegistry } from './numbering';

describe('FolioPool', () => {
  it('has no range and next() throws until loadRange() is called', () => {
    const pool = new FolioPool();
    const log = new RecordingComplianceLogger();
    expect(pool.hasRange('MX-INVOICE')).toBe(false);
    expect(() => pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log)).toThrow(/No folio range loaded/);
  });

  it('after loadRange(), next() allocates sequentially from the range', () => {
    const pool = new FolioPool();
    const log = new RecordingComplianceLogger();
    pool.loadRange('MX-INVOICE', 100, 102);
    expect(pool.hasRange('MX-INVOICE')).toBe(true);
    expect(pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log).value).toBe('100');
    expect(pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log).value).toBe('101');
    expect(pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log).value).toBe('102');
  });

  it('never reuses a number and blocks once the range is exhausted', () => {
    const pool = new FolioPool();
    const log = new RecordingComplianceLogger();
    pool.loadRange('MX-INVOICE', 1, 1);
    expect(pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log).value).toBe('1');
    expect(() => pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log)).toThrow(/exhausted/i);
    // Still exhausted on a second attempt — no accidental reuse/reset.
    expect(() => pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log)).toThrow(/exhausted/i);
  });

  it('different series have independent ranges', () => {
    const pool = new FolioPool();
    const log = new RecordingComplianceLogger();
    pool.loadRange('MX-INVOICE', 1, 1);
    pool.loadRange('MX-CREDIT_NOTE', 500, 500);
    expect(pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log).value).toBe('1');
    expect(pool.next('MX-CREDIT_NOTE', { model: 'AUTHORITY_RANGE' }, log).value).toBe('500');
  });
});

describe('GaplessSelfNumberer', () => {
  it('never throws and increments per series regardless of any range source (AUTHORITY_RANGE-only concern)', () => {
    const numberer = new GaplessSelfNumberer();
    const log = new RecordingComplianceLogger();
    expect(numberer.next('FR-INVOICE', { model: 'GAPLESS_SELF' }, log).value).toBe('000001');
    expect(numberer.next('FR-INVOICE', { model: 'GAPLESS_SELF' }, log).value).toBe('000002');
  });
});

describe('AuthorityRangeSource', () => {
  it('NullAuthorityRangeSource never has a range (offline-safe default)', async () => {
    const source = new NullAuthorityRangeSource();
    expect(await source.getRange('any-co', 'MX-INVOICE')).toBeNull();
    expect(await source.getRange(undefined, 'MX-INVOICE')).toBeNull();
  });

  it('ConfigAuthorityRangeSource serves back a configured range, keyed by (companyId, series)', () => {
    const source = new ConfigAuthorityRangeSource();
    source.configure('co-1', 'MX-INVOICE', { from: 1, to: 10 });
    expect(source.getRange('co-1', 'MX-INVOICE')).toEqual({ from: 1, to: 10 });
    // A different company or a different series is not configured.
    expect(source.getRange('co-2', 'MX-INVOICE')).toBeNull();
    expect(source.getRange('co-1', 'MX-CREDIT_NOTE')).toBeNull();
  });

  it('configure() rejects an inverted range', () => {
    const source = new ConfigAuthorityRangeSource();
    expect(() => source.configure('co-1', 'MX-INVOICE', { from: 10, to: 1 })).toThrow(
      /from .* must be <= to/,
    );
  });

  it('clear() removes a configured range', () => {
    const source = new ConfigAuthorityRangeSource();
    source.configure('co-1', 'MX-INVOICE', { from: 1, to: 10 });
    source.clear('co-1', 'MX-INVOICE');
    expect(source.getRange('co-1', 'MX-INVOICE')).toBeNull();
  });
});

describe('hydrateAuthorityRange (the loadRange() wiring fix)', () => {
  it('is a no-op for GAPLESS_SELF — never touches the pool', async () => {
    const pool = new FolioPool();
    const source = new ConfigAuthorityRangeSource();
    source.configure('co-1', 'FR-INVOICE', { from: 1, to: 10 });
    const log = new RecordingComplianceLogger();
    await hydrateAuthorityRange(pool, 'GAPLESS_SELF', source, 'co-1', 'FR-INVOICE', log);
    expect(pool.hasRange('FR-INVOICE')).toBe(false);
  });

  it('loads the range from the source into the pool for AUTHORITY_RANGE', async () => {
    const pool = new FolioPool();
    const source = new ConfigAuthorityRangeSource();
    source.configure('co-1', 'MX-INVOICE', { from: 5, to: 8 });
    const log = new RecordingComplianceLogger();
    await hydrateAuthorityRange(pool, 'AUTHORITY_RANGE', source, 'co-1', 'MX-INVOICE', log);
    expect(pool.hasRange('MX-INVOICE')).toBe(true);
    expect(pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log).value).toBe('5');
  });

  it('does nothing when the source has no range configured (honest — next() will still throw)', async () => {
    const pool = new FolioPool();
    const source = new NullAuthorityRangeSource();
    const log = new RecordingComplianceLogger();
    await hydrateAuthorityRange(pool, 'AUTHORITY_RANGE', source, 'co-1', 'MX-INVOICE', log);
    expect(pool.hasRange('MX-INVOICE')).toBe(false);
  });

  it('never reloads a series that already has a range (would reset the cursor / violate "never reuse")', async () => {
    const pool = new FolioPool();
    pool.loadRange('MX-INVOICE', 1, 1);
    pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, new RecordingComplianceLogger()); // consume the only folio
    const source = new ConfigAuthorityRangeSource();
    source.configure('co-1', 'MX-INVOICE', { from: 100, to: 200 }); // a "fresh" range from the source
    const log = new RecordingComplianceLogger();
    await hydrateAuthorityRange(pool, 'AUTHORITY_RANGE', source, 'co-1', 'MX-INVOICE', log);
    // Still exhausted — the already-loaded (and consumed) range was NOT replaced.
    expect(() => pool.next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log)).toThrow(/exhausted/i);
  });
});

describe('NumberingRegistry.ensureRange', () => {
  it('hydrates its own FolioPool from the injected source before next() is called', async () => {
    const registry = new NumberingRegistry();
    const source = new ConfigAuthorityRangeSource();
    source.configure('co-1', 'MX-INVOICE', { from: 42, to: 42 });
    const log = new RecordingComplianceLogger();
    await registry.ensureRange('AUTHORITY_RANGE', 'co-1', 'MX-INVOICE', log, source);
    expect(registry.get('AUTHORITY_RANGE').next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log).value).toBe(
      '42',
    );
  });

  it('defaults to the offline-safe NullAuthorityRangeSource when none is injected', async () => {
    const registry = new NumberingRegistry();
    const log = new RecordingComplianceLogger();
    await registry.ensureRange('AUTHORITY_RANGE', 'co-1', 'MX-INVOICE', log);
    expect(() =>
      registry.get('AUTHORITY_RANGE').next('MX-INVOICE', { model: 'AUTHORITY_RANGE' }, log),
    ).toThrow(/No folio range loaded/);
  });
});
