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
import { buildExpenseDescriptor } from '../../descriptors/expense.descriptor';
import { buildReceivedInvoiceDescriptor } from '../../descriptors/received-invoice.descriptor';
import { ALL_COUNTRY_POLICY_FILES } from './all';

// The THIRD-PARTY "duplicate" extension (actions/duplicate-extension.ts) is attached to BOTH
// "quote" and "invoice" (documents-core.module.ts, root TODO item 5 — the invoice case needed it
// for the recurring-documents mechanism), outside either type's own descriptor — listed here by
// hand since this test deliberately stays independent of Nest wiring, the same way
// documents.service.spec.ts's own `buildService()` re-lists it rather than booting the whole module.
const NATIVE_TYPE_ACTIONS: { typeId: string; actionId: string }[] = [
  ...buildQuoteDescriptor().actions.map((a) => ({ typeId: 'quote', actionId: a.id })),
  { typeId: 'quote', actionId: 'duplicate' },
  ...buildInvoiceDescriptor().actions.map((a) => ({ typeId: 'invoice', actionId: a.id })),
  { typeId: 'invoice', actionId: 'duplicate' },
  ...buildCreditNoteDescriptor().actions.map((a) => ({ typeId: 'credit-note', actionId: a.id })),
  ...buildExpenseDescriptor().actions.map((a) => ({ typeId: 'expense', actionId: a.id })),
  ...buildReceivedInvoiceDescriptor().actions.map((a) => ({ typeId: 'received-invoice', actionId: a.id })),
];

const ALL_DOCUMENT_TYPE_IDS = ['quote', 'invoice', 'credit-note', 'expense', 'received-invoice'];

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

  // The NEW "which types this country has" layer (schema.ts's `documentTypes`) — a separate
  // declaration from `rules` above, so it needs its own coverage guard the same way `rules` already
  // has one just above.
  it('FR and US both declare every document type the core registers today', () => {
    for (const code of ['FR', 'US']) {
      const file = fileFor(code);
      expect((file.documentTypes ?? []).slice().sort()).toEqual(ALL_DOCUMENT_TYPE_IDS.slice().sort());
    }
  });

  // The per-status narrowing (schema.ts's `DocumentActionRuleFact.statuses`) — TWO real, shipped
  // examples: FR's invoice.save-draft (the original example — "an issued invoice is no longer
  // editable"), and received-invoice.receive in BOTH shipped files (root TODO item 18 — "a reviewed
  // [approved/rejected] received invoice's fields are no longer editable", the same shape of fact
  // applied to a different type's own lifecycle). Root TODO item 21 (2026-09-01) promoted FR's
  // invoice.save-draft to `legal` (CGI art. 289 I.5, read directly — see its own `notes`);
  // received-invoice.receive stays `unverified` in both files (neither rule's own resolutionNote
  // named a checkable text for the STATUS narrowing itself, as opposed to the separate, already-
  // sourced reception-channel mandate FR's own rule documents).
  it('invoice.save-draft (FR) and received-invoice.receive (FR+US) restrict to their own "still editable" status', () => {
    const fr = fileFor('FR');
    const us = fileFor('US');
    expect(fr.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')?.statuses).toEqual([
      'draft',
    ]);
    expect(
      fr.rules.find((r) => r.typeId === 'received-invoice' && r.actionId === 'receive')?.statuses,
    ).toEqual(['received']);
    expect(
      us.rules.find((r) => r.typeId === 'received-invoice' && r.actionId === 'receive')?.statuses,
    ).toEqual(['received']);
  });

  it('no OTHER shipped rule declares a per-status narrowing — these two stay the only deliberate examples', () => {
    const isKnownNarrowing = (countryCode: string, typeId: string, actionId: string) =>
      (typeId === 'invoice' && actionId === 'save-draft' && countryCode === 'FR') ||
      (typeId === 'received-invoice' && actionId === 'receive');

    for (const file of ALL_COUNTRY_POLICY_FILES) {
      for (const rule of file.rules) {
        if (isKnownNarrowing(file.countryCode, rule.typeId, rule.actionId)) continue;
        expect(rule.statuses ?? []).toEqual([]);
      }
    }
  });

  it('every `documentTypes` entry in every shipped file names a type the core actually registers — no stale or misspelled id', () => {
    for (const file of ALL_COUNTRY_POLICY_FILES) {
      const unknown = (file.documentTypes ?? []).filter((typeId) => !ALL_DOCUMENT_TYPE_IDS.includes(typeId));
      expect(unknown).toEqual([]);
    }
  });
});

// Root TODO item 21 — "Sourcer FR et US": the primary texts were read this time (codes.droit.org, a
// Légifrance mirror, for the CGI/code civil articles; govinfo.gov, the official US Government
// Publishing Office, for the US Code) — three FR rules promoted to "legal", pinned here by their
// exact reference the same way country-identifiers/data/all.spec.ts pins GB's own promoted VAT fact.
describe('country-policy/data — FR rules promoted to "legal" by root TODO item 21 (2026-09-01)', () => {
  it('FR quote.send cites code civil art. 1366 (the electronic writing has the same probative force as paper)', () => {
    const fr = fileFor('FR');
    const rule = fr.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/même force probante/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(rule.notes).toMatch(/art\. 1366/);
  });

  it('FR invoice.send cites CGI art. 289 VI (electronic invoices are emitted and received in electronic form)', () => {
    const fr = fileFor('FR');
    const rule = fr.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/factures électroniques sont émises et reçues/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(rule.notes).toMatch(/289, VI/);
  });

  it('FR invoice.save-draft cites CGI art. 289 I.5 (a correction is a new, referencing document — never a silent rewrite of the original)', () => {
    const fr = fileFor('FR');
    const rule = fr.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/modifie la facture initiale/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(rule.statuses).toEqual(['draft']); // the underlying restriction this citation now grounds
  });

  it("US quote.send/invoice.send E-SIGN citation was re-verified 2026-09-01 against the official govinfo.gov text, not just Cornell's mirror", () => {
    const us = fileFor('US');
    for (const actionId of ['send'] as const) {
      const quoteRule = us.rules.find((r) => r.typeId === 'quote' && r.actionId === actionId)!;
      const invoiceRule = us.rules.find((r) => r.typeId === 'invoice' && r.actionId === actionId)!;
      for (const rule of [quoteRule, invoiceRule]) {
        expect(rule.provenance.kind).toBe('legal');
        if (rule.provenance.kind === 'legal') expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
        expect(rule.notes).toMatch(/govinfo\.gov/);
      }
    }
  });
});
