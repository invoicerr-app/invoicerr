/**
 * Coverage guard for the SHIPPED identifier-requirements files — the same role
 * country-policy/data/all.spec.ts plays for the action-policy files, scaled to this concern.
 */
import { ALL_COUNTRY_IDENTIFIER_FILES } from './all';

function fileFor(countryCode: string) {
  const file = ALL_COUNTRY_IDENTIFIER_FILES.find((f) => f.countryCode === countryCode);
  if (!file) throw new Error(`No identifier-requirements file loaded for "${countryCode}"`);
  return file;
}

describe('country-identifiers/data — the shipped FR and US files', () => {
  it('loads exactly the two countries this task asked for, at minimum', () => {
    const codes = ALL_COUNTRY_IDENTIFIER_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(expect.arrayContaining(['FR', 'US']));
  });

  it('every fact in every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit here)', () => {
    for (const file of ALL_COUNTRY_IDENTIFIER_FILES) {
      for (const fact of file.schemes) {
        expect(['legal', 'unverified']).toContain(fact.provenance.kind);
      }
    }
  });

  // Honest state check, not an aspiration: neither FR nor US could be sourced to an exact primary
  // text that speaks to the actual claim made (see each fact's own resolutionNote for what was
  // tried and why it fell short) — see this module's schema.ts header. A future research pass that
  // upgrades one of these to "legal" should EDIT this test, not be blocked by it.
  it('every shipped fact is honestly marked "unverified" today, each with its own substantive, non-shared resolutionNote', () => {
    const facts = ALL_COUNTRY_IDENTIFIER_FILES.flatMap((f) => f.schemes);
    expect(facts.length).toBeGreaterThan(0);
    const seenNotes = new Set<string>();
    for (const fact of facts) {
      expect(fact.provenance.kind).toBe('unverified');
      const note = (fact.provenance as { resolutionNote: string }).resolutionNote;
      expect(note.length).toBeGreaterThan(40);
      expect(seenNotes.has(note)).toBe(false); // no fact borrows another's note verbatim
      seenNotes.add(note);
    }
  });

  it('FR requires a LEGAL_ID for BOTH party types and also declares a VAT scheme — US does not', () => {
    const fr = fileFor('FR');
    const frLegalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID');
    expect(frLegalId?.appliesTo).toBe('BOTH');
    expect(frLegalId?.required).toBe(true);
    expect(fr.schemes.some((s) => s.scheme === 'VAT')).toBe(true);

    const us = fileFor('US');
    expect(us.schemes.some((s) => s.scheme === 'VAT')).toBe(false);
  });

  it('FR and US genuinely differ — not a copy of one another with only the label swapped', () => {
    const fr = fileFor('FR');
    const us = fileFor('US');
    const frLegalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const usLegalId = us.schemes.find((s) => s.scheme === 'LEGAL_ID')!;

    expect(frLegalId.label).not.toBe(usLegalId.label);
    expect(frLegalId.appliesTo).not.toBe(usLegalId.appliesTo);
    expect(frLegalId.required).not.toBe(usLegalId.required);
    expect(fr.schemes.length).not.toBe(us.schemes.length);
  });

  it('every `scheme` used by a shipped file is one of the two the frontend actually special-cases ("LEGAL_ID", "VAT") — a third scheme would silently render with no dedicated data-cy', () => {
    const knownSchemes = new Set(['LEGAL_ID', 'VAT']);
    for (const file of ALL_COUNTRY_IDENTIFIER_FILES) {
      for (const fact of file.schemes) {
        expect(knownSchemes.has(fact.scheme)).toBe(true);
      }
    }
  });
});
