/**
 * Coverage guard for the SHIPPED `numbering` facts (schema.ts's `CountryDocumentPolicyFile.numbering`,
 * issue #471) - the same role all.spec.ts already plays for `rules`, scaled to this new, separate
 * layer: every shipped country must say what it requires of a credit note's numbering, WITH
 * provenance (already enforced at load time by data/all.ts's own `assertValidNumberingProvenance`
 * call - this file makes that property explicit and, more importantly, proves the ONE cross-check
 * that actually matters: a country's own claim ("credit-note must be sequentially numbered") is never
 * allowed to drift from what the descriptor layer ACTUALLY does (`credit-note.descriptor.ts`'s own
 * `numbering` field) - see the last `it` below.
 */
import { buildCreditNoteDescriptor } from '../../descriptors/credit-note.descriptor';
import { ALL_COUNTRY_POLICY_FILES } from './all';

function fileFor(countryCode: string) {
  const file = ALL_COUNTRY_POLICY_FILES.find((f) => f.countryCode === countryCode);
  if (!file) throw new Error(`No policy file loaded for "${countryCode}"`);
  return file;
}

describe('country-policy/data - the `numbering` facts (issue #471)', () => {
  it('every one of the five shipped countries declares a credit-note numbering fact', () => {
    for (const code of ['FR', 'DE', 'IT', 'PL', 'PT']) {
      const fact = fileFor(code).numbering?.find((f) => f.typeId === 'credit-note');
      expect(fact).toBeDefined();
    }
  });

  it('every numbering fact carries a real provenance (already enforced at load time - this makes the property explicit)', () => {
    for (const file of ALL_COUNTRY_POLICY_FILES) {
      for (const fact of file.numbering ?? []) {
        expect(['legal', 'unverified']).toContain(fact.provenance.kind);
      }
    }
  });

  it('at least one shipped numbering fact is "legal" (FR/PL) and at least one is "unverified" (DE/IT) - both branches of the format are actually exercised', () => {
    const allFacts = ALL_COUNTRY_POLICY_FILES.flatMap((f) => f.numbering ?? []);
    expect(allFacts.some((f) => f.provenance.kind === 'legal')).toBe(true);
    expect(allFacts.some((f) => f.provenance.kind === 'unverified')).toBe(true);
  });

  it('FR requires a sequential number, sourced to CGI ann. II art. 242 nonies A, I, 7°', () => {
    const fact = fileFor('FR').numbering!.find((f) => f.typeId === 'credit-note')!;
    expect(fact.requirement).toBe('sequential-number-required');
    expect(fact.provenance.kind).toBe('legal');
    if (fact.provenance.kind === 'legal') {
      expect(fact.provenance.sourceText).toMatch(/séquence chronologique et continue/);
      expect(fact.provenance.sourceCheckedAt).toBe('2026-09-26');
    }
  });

  it('PT requires a sequential number, sourced to CIVA art. 36.º n.º 6', () => {
    const fact = fileFor('PT').numbering!.find((f) => f.typeId === 'credit-note')!;
    expect(fact.requirement).toBe('sequential-number-required');
    expect(fact.provenance.kind).toBe('legal');
    if (fact.provenance.kind === 'legal') {
      expect(fact.provenance.sourceText).toMatch(/numeração sequencial/);
    }
    // The honest ATCUD gap - see this fact's own `notes` and actions/atcud-issuance.ts's own header.
    expect(fact.notes).toMatch(/ATCUD/);
  });

  it('DE and IT require a sequential number but stay honestly `unverified`, each naming what would settle it', () => {
    for (const code of ['DE', 'IT']) {
      const fact = fileFor(code).numbering!.find((f) => f.typeId === 'credit-note')!;
      expect(fact.requirement).toBe('sequential-number-required');
      expect(fact.provenance.kind).toBe('unverified');
      if (fact.provenance.kind === 'unverified') {
        expect(fact.provenance.resolutionNote.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("PL says the credit-note TYPE is not issuable at all (a Polish correction is an invoice/KOR, numbered by the invoice's own numbering)", () => {
    const fact = fileFor('PL').numbering!.find((f) => f.typeId === 'credit-note')!;
    expect(fact.requirement).toBe('type-not-issuable');
    expect(fact.provenance.kind).toBe('legal');
    expect(fact.notes).toMatch(/KOR/);
  });

  // THE cross-check this whole file exists for: a country claiming "sequential-number-required" for a
  // typeId is worthless if the descriptor that type actually runs through never numbers it at all  -
  // the two layers (country-policy's own legal claim, descriptors/*.descriptor.ts's own numbering
  // mechanism) must never drift apart, the same discipline lifecycle.ts's own
  // `transitionsAvailableWhen`/`availableWhen` cross-check already holds for a different pair of
  // facts.
  it('every country claiming "sequential-number-required" for a typeId is backed by that type actually declaring `numbering`', () => {
    const creditNoteDescriptor = buildCreditNoteDescriptor();
    const descriptorsByTypeId: Record<string, { numbering?: unknown }> = {
      'credit-note': creditNoteDescriptor,
    };

    for (const file of ALL_COUNTRY_POLICY_FILES) {
      for (const fact of file.numbering ?? []) {
        if (fact.requirement !== 'sequential-number-required') continue;
        const descriptor = descriptorsByTypeId[fact.typeId];
        expect(
          descriptor,
          `${file.countryCode} claims "sequential-number-required" for "${fact.typeId}", but this ` +
            "test does not know that type's descriptor at all - add it to descriptorsByTypeId above.",
        ).toBeDefined();
        expect(
          descriptor?.numbering,
          `${file.countryCode} claims "sequential-number-required" for "${fact.typeId}", but that ` +
            "type's own descriptor declares no `numbering` at all - the legal claim and the actual " +
            'mechanism have drifted apart.',
        ).toBeDefined();
      }
    }
  });
});
