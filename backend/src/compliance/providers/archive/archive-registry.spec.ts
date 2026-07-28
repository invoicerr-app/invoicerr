import { RecordingComplianceLogger } from '../../execution/logger';
import { ArchivalPolicy } from '../../profiles/schema';
import { ArchiveProviderRegistry, defaultArchiveRegistry } from './registry';
import { LocalArchiveProvider } from './providers';

const policy = (residency?: string): ArchivalPolicy => ({
  retentionYears: 5,
  residency,
  archivedForm: 'AUTHORITATIVE_XML',
  integrity: 'SIGNED',
});

describe('ArchiveProviderRegistry', () => {
  it('routes a residency-constrained policy to a regional WORM bucket', () => {
    const log = new RecordingComplianceLogger();
    for (const region of ['MX', 'BR', 'SA']) {
      const receipt = defaultArchiveRegistry.store([], policy(region), log);
      expect(receipt.providerId).toBe('s3-worm');
      expect(receipt.region).toBe(region);
    }
  });

  it('retention is computed from the policy years', () => {
    const receipt = defaultArchiveRegistry.store([], policy('EU'), new RecordingComplianceLogger());
    expect(new Date(receipt.retentionUntil).getFullYear()).toBe(new Date().getFullYear() + 5);
  });

  it('an unconstrained residency uses the default provider (GLOBAL)', () => {
    const receipt = defaultArchiveRegistry.store([], policy(), new RecordingComplianceLogger());
    expect(receipt.region).toBe('GLOBAL');
  });

  it('falls back to a non-WORM provider when no bucket serves the residency', () => {
    // A registry with only the Local provider can't serve MX → returns the default (local).
    const reg = new ArchiveProviderRegistry([new LocalArchiveProvider()]);
    expect(reg.select(policy('MX')).id).toBe('local');
  });
});
