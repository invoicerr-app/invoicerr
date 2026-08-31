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
