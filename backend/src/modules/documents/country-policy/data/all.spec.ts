/**
 * Coverage guard for the SHIPPED policy files — the same role coverage.spec.ts played for the
 * removed compliance engine's country profiles, scaled to this concern: FR is this module's
 * reference jurisdiction (every e2e/jest fixture company is French — see
 * e2e/cypress/support/commands.ts's `resetAndSeed`), so a native action the core declares but FR's
 * file doesn't cover would silently 403 every existing test and, worse, every real French company.
 * This test makes that a loud, named failure at the file level instead.
 */
import { buildQuoteDescriptor } from '../../descriptors/quote.descriptor';
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildCreditNoteDescriptor } from '../../descriptors/credit-note.descriptor';
import { ALL_COUNTRY_POLICY_FILES } from './all';

// The THIRD-PARTY "duplicate" extension (actions/duplicate-extension.ts) is attached to "quote" in
// documents.module.ts, outside any type's own descriptor — listed here by hand since this test
// deliberately stays independent of Nest wiring, the same way documents.service.spec.ts's own
// `buildService()` re-lists it rather than booting the whole module.
const NATIVE_TYPE_ACTIONS: { typeId: string; actionId: string }[] = [
  ...buildQuoteDescriptor().actions.map((a) => ({ typeId: 'quote', actionId: a.id })),
  { typeId: 'quote', actionId: 'duplicate' },
  ...buildInvoiceDescriptor().actions.map((a) => ({ typeId: 'invoice', actionId: a.id })),
  ...buildCreditNoteDescriptor().actions.map((a) => ({ typeId: 'credit-note', actionId: a.id })),
];

function fileFor(countryCode: string) {
  const file = ALL_COUNTRY_POLICY_FILES.find((f) => f.countryCode === countryCode);
  if (!file) throw new Error(`No policy file loaded for "${countryCode}"`);
  return file;
}

describe('country-policy/data — the shipped FR and US files', () => {
  it('loads exactly the two countries this task asked for, at minimum', () => {
    const codes = ALL_COUNTRY_POLICY_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(expect.arrayContaining(['FR', 'US']));
  });

  it('FR — the reference jurisdiction every test fixture company uses — declares a rule for EVERY native action the core exposes today', () => {
    const fr = fileFor('FR');
    const declared = new Set(fr.rules.map((r) => `${r.typeId}::${r.actionId}`));

    const missing = NATIVE_TYPE_ACTIONS.map(({ typeId, actionId }) => `${typeId}::${actionId}`).filter(
      (key) => !declared.has(key),
    );
    expect(missing).toEqual([]);
  });

  it('FR allows every native action — the reference jurisdiction never itself needs an unblock', () => {
    const fr = fileFor('FR');
    const forbidden = fr.rules.filter((r) => !r.allowed);
    expect(forbidden).toEqual([]);
  });

  it('US deliberately does NOT cover quote.duplicate — a real, documented gap, not an oversight', () => {
    const us = fileFor('US');
    const declared = new Set(us.rules.map((r) => `${r.typeId}::${r.actionId}`));
    expect(declared).not.toContain('quote::duplicate');
    expect(us.notes).toMatch(/duplicate/);
  });

  it('every rule in every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit here)', () => {
    for (const file of ALL_COUNTRY_POLICY_FILES) {
      for (const rule of file.rules) {
        expect(['legal', 'unverified']).toContain(rule.provenance.kind);
      }
    }
  });

  it('at least one shipped rule is "legal" and at least one is "unverified" — the format is actually exercised both ways, not just declared', () => {
    const allRules = ALL_COUNTRY_POLICY_FILES.flatMap((f) => f.rules);
    expect(allRules.some((r) => r.provenance.kind === 'legal')).toBe(true);
    expect(allRules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });
});
