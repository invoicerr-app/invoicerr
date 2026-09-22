import { ALL_CONTENT_REQUIREMENT_FILES } from './all';

describe('content-requirements/data — the shipped catalog', () => {
  it('loads exactly France today — the only country a real PDP poll ever cited BT-23 for', () => {
    expect(ALL_CONTENT_REQUIREMENT_FILES.map((f) => f.countryCode)).toEqual(['FR']);
  });

  it('the France file carries BT-23, with a real legal citation and a consultation date', () => {
    const fr = ALL_CONTENT_REQUIREMENT_FILES.find((f) => f.countryCode === 'FR');
    expect(fr?.facts).toHaveLength(1);
    const fact = fr!.facts[0];
    expect(fact.field).toBe('BT-23');
    expect(fact.mandatedFrom).toBe('2026-09-01');
    expect(fact.provenance.kind).toBe('legal');
    expect((fact.provenance as { sourceText: string }).sourceText).toContain('8° bis');
    expect((fact.provenance as { sourceCheckedAt: string }).sourceCheckedAt).toBeTruthy();
  });
});

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds.
describe('content-requirements/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_CONTENT_REQUIREMENT_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_CONTENT_REQUIREMENT_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
