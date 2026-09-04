/**
 * Content-pinning + schema-gate spec for `data/cy.json` — the AGENT PAYS CY deliverable (lot 2,
 * TODO_DOCUMENTS.md vague B). Deliberately does NOT go through `all.ts`/`all.spec.ts` (both are
 * mandataire-only for validation, and `cy` is not registered in `all.ts`'s own `COUNTRY_FILES` list
 * yet — adding it there is the mandataire's call, not this agent's) — this spec reads `cy.json`
 * directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate `all.ts` would run,
 * so the file is proven valid on its own before it is ever wired into the aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadCy(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'cy.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/cy.json`);
  return rule;
}

describe('CY — country-policy/data/cy.json', () => {
  const cy = loadCy();

  it('declares countryCode "CY", matching its own filename', () => {
    expect(cy.countryCode).toBe('CY');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((cy.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of cy.rules) {
      expect(() => assertValidProvenance(rule, 'data/cy.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file', () => {
    const declared = cy.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
    expect(declared).toEqual(
      [
        'quote::save-draft',
        'quote::send',
        'quote::convert-to-invoice',
        'quote::request-deposit',
        'quote::duplicate',
        'quote::share-link',
        'invoice::save-draft',
        'invoice::send',
        'invoice::duplicate',
        'invoice::record-payment',
        'invoice::download-xml',
        'invoice::export-accounting',
        'invoice::share-link',
        'credit-note::save-draft',
        'credit-note::send',
        'credit-note::share-link',
        'expense::save-draft',
        'expense::delete',
        'received-invoice::receive',
        'received-invoice::approve',
        'received-invoice::reject',
        'received-invoice::delete',
      ].sort(),
    );
  });

  it('allows every one of its 22 rules — CY never itself needs an unblock', () => {
    expect(cy.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least one "legal" and several "unverified" rules — a real, honest research pass', () => {
    expect(cy.rules.some((r) => r.provenance.kind === 'legal')).toBe(true);
    expect(cy.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('quote.send reuses the exact eIDAS Regulation art. 25(1) text already verified elsewhere in this lot', () => {
    const rule = ruleFor(cy, 'quote', 'send');
    expect(rule.provenance.kind).toBe('legal');
    const sourceText = (rule.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/electronic signature/i);
    expect(sourceText).toMatch(/solely on the grounds/);
    expect(sourceText).toMatch(/qualified electronic signatures/i);
  });

  it('invoice.save-draft is restricted to "draft", sourced to the Tenth Schedule (art. 43) para. 2(2)', () => {
    const rule = ruleFor(cy, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    const sourceText = (rule.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/τιμολόγιο Φ\.Π\.Α/);
    expect(sourceText).toMatch(/προορίζεται να το τροποποιήσει/);
  });

  it('invoice.send is sourced to the Tenth Schedule (art. 43) para. 1Α — VAT invoice content', () => {
    const rule = ruleFor(cy, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    const sourceText = (rule.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/Τιμολόγια Φ\.Π\.Α/);
    expect(sourceText).toMatch(/1Α/);
    expect(rule.notes).toMatch(/Κανονισμοί|Règlements/);
  });

  it('credit-note.send reuses the SAME Tenth Schedule text as invoice.save-draft — no named CY instrument', () => {
    const invoiceRule = ruleFor(cy, 'invoice', 'save-draft');
    const creditNoteRule = ruleFor(cy, 'credit-note', 'send');
    expect(creditNoteRule.provenance.kind).toBe('legal');
    expect((creditNoteRule.provenance as { sourceText: string }).sourceText).toBe(
      (invoiceRule.provenance as { sourceText: string }).sourceText,
    );
    expect(creditNoteRule.notes).toMatch(/πιστωτικό σημείωμα|χρεωστικό σημείωμα/);
  });

  it('the file-level notes documents the mof.gov.cy/tax.mof.gov.cy access wall, honestly', () => {
    expect(cy.notes ?? '').toMatch(/mof\.gov\.cy/);
    expect(cy.notes ?? '').toMatch(/tax\.mof\.gov\.cy/);
    expect(cy.notes ?? '').toMatch(/Κανονισμοί/);
  });

  it('the file-level notes documents the discarded fabricated "12A/12B" citation, never used in this file', () => {
    expect(cy.notes ?? '').toMatch(/12A\/12B|fabriquée|halluciné/i);
    const allSourceTexts = cy.rules
      .filter((r) => r.provenance.kind === 'legal')
      .map((r) => (r.provenance as { sourceText: string }).sourceText)
      .join('\n');
    expect(allSourceTexts).not.toMatch(/Διορθωτικό τιμολόγιο/);
  });
});
