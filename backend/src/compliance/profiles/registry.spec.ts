import { ProfileRegistry, defaultRegistry } from './registry';

describe('ProfileRegistry', () => {
  it('resolves a known country profile', () => {
    const r = defaultRegistry.resolve('US');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('US');
  });

  it('is case-insensitive on the country code', () => {
    expect(defaultRegistry.resolve('fr').profile.countryCode).toBe('FR');
  });

  it('follows delegation (Monaco → France)', () => {
    const r = defaultRegistry.resolve('MC');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('FR');
    expect(r.delegatedFrom).toBe('MC');
  });

  it('falls back safely for an unknown country, preserving the requested code', () => {
    const r = defaultRegistry.resolve('ZZ');
    expect(r.isFallback).toBe(true);
    expect(r.profile.countryCode).toBe('ZZ');
    expect(r.profile.confidence).toBe('FALLBACK');
  });

  it('reports membership via has()', () => {
    expect(defaultRegistry.has('MX')).toBe(true);
    expect(defaultRegistry.has('ZZ')).toBe(false);
  });

  it('accepts extra profiles via the constructor (open for extension)', () => {
    const custom = new ProfileRegistry({
      DE: {
        countryCode: 'DE',
        displayName: 'Germany',
        schemaVersion: '1.0',
        confidence: 'BEST_EFFORT',
        regime: [],
        formats: [],
        transmission: [],
        taxSystem: { kind: 'VAT', standardRate: 19 },
        lifecycle: [],
        archival: [],
        reporting: [],
        numbering: [],
      },
    });
    expect(custom.resolve('DE').isFallback).toBe(false);
    expect(custom.resolve('DE').profile.confidence).toBe('BEST_EFFORT');
  });
});
