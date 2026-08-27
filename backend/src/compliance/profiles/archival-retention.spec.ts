/**
 * Retention durations are legal values, not defaults — a wrong one either over-retains personal
 * data or destroys evidence early. These lock the two the audit verified against primary sources,
 * and the temporal split that keeps already-issued documents on the rule that applied to them.
 */
import { DE } from './data/de';
import { MX } from './data/mx';
import { pickByDate } from './temporal';

const at = (iso: string) => new Date(iso);

describe('archival retention — DE-D1: eight years, not ten', () => {
  it('retains for 8 years from 2025-01-01 (§ 14b Abs. 1 S. 1 UStG, "acht Jahre", BEG IV)', () => {
    expect(pickByDate(DE.archival, at('2026-08-27'))?.retentionYears).toBe(8);
  });

  it('keeps 10 years for documents issued before the reduction took effect', () => {
    expect(pickByDate(DE.archival, at('2024-06-01'))?.retentionYears).toBe(10);
  });

  it('switches exactly on 2025-01-01, not before', () => {
    expect(pickByDate(DE.archival, at('2024-12-31'))?.retentionYears).toBe(10);
    expect(pickByDate(DE.archival, at('2025-01-01'))?.retentionYears).toBe(8);
  });
});

describe('archival retention — Mexico', () => {
  it('retains for 5 years (CFF art. 30)', () => {
    expect(pickByDate(MX.archival, at('2026-08-27'))?.retentionYears).toBe(5);
  });

  /**
   * MX-D3: kept deliberately. The sourced law requires availability at the domicilio fiscal, not
   * physical residency — but `residency` also drives archive routing, so dropping it is a
   * data-location decision for the business, not an audit correction. This test exists so the
   * value cannot be changed silently either way.
   */
  it('still declares MX residency — a business decision, not an oversight', () => {
    expect(pickByDate(MX.archival, at('2026-08-27'))?.residency).toBe('MX');
  });
});
