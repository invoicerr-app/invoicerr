/**
 * Content-pinning + schema-gate spec for `data/gr.json` — the AGENT PAYS GR deliverable (lot 2,
 * TODO_DOCUMENTS.md vague B). Deliberately does NOT go through `all.ts`/`all.spec.ts` (both are
 * mandataire-only for validation, and `gr` is not registered in `all.ts`'s own `COUNTRY_FILES` list
 * yet — adding it there is the mandataire's call, not this agent's) — this spec reads `gr.json`
 * directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate `all.ts` would run,
 * so the file is proven valid on its own before it is ever wired into the aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadGr(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'gr.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/gr.json`);
  return rule;
}

describe('GR — country-policy/data/gr.json', () => {
  const gr = loadGr();

  it('declares countryCode "GR", matching its own filename', () => {
    expect(gr.countryCode).toBe('GR');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((gr.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of gr.rules) {
      expect(() => assertValidProvenance(rule, 'data/gr.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file, no duplicates', () => {
    const declared = gr.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
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
    expect(new Set(declared).size).toBe(22);
  });

  it('allows every one of its 22 rules — GR never itself needs an unblock', () => {
    expect(gr.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least three "legal" rules and several "unverified" rules — a real, honest research pass', () => {
    const legalCount = gr.rules.filter((r) => r.provenance.kind === 'legal').length;
    expect(legalCount).toBeGreaterThanOrEqual(3);
    expect(gr.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('invoice.save-draft is restricted to "draft" and sourced to Ν.4308/2014 άρθρο 8 § 3 — a direct FR/BE-style document-modification-assimilation clause', () => {
    const rule = ruleFor(gr, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/θεωρείται τιμολόγιο/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(rule.notes).toMatch(/άρθρο 8 § 3/);
  });

  it('invoice.send is sourced to Ν.4308/2014 άρθρο 14 and documents the mandatory-acceptance divergence from FR/DE/NL/AT/BE', () => {
    const rule = ruleFor(gr, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/υποχρεωτικά αποδεκτή/);
    }
    expect(rule.notes).toMatch(/DIVERGENCE RÉELLE/);
  });

  it('credit-note.send documents the "πιστωτικό τιμολόγιο" (credit invoice) as a legally named instrument, distinct from the product-level status transition', () => {
    const rule = ruleFor(gr, 'credit-note', 'send');
    expect(rule.provenance.kind).toBe('unverified');
    expect(rule.notes).toMatch(/πιστωτικό τιμολόγιο/);
  });

  it('the file-level notes documents the aade.gr wall, the e-nomothesia.gr unreachability, and the forin.gr JSON-endpoint method used instead', () => {
    expect(gr.notes ?? '').toMatch(/aade\.gr/);
    expect(gr.notes ?? '').toMatch(/e-nomothesia\.gr/);
    expect(gr.notes ?? '').toMatch(/forin\.gr/);
  });
});
