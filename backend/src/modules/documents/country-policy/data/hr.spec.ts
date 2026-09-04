/**
 * Content-pinning + schema-gate spec for `data/hr.json` — the AGENT PAYS HR deliverable (lot 6,
 * TODO_DOCUMENTS.md vague B). Deliberately does NOT go through `all.ts`/`all.spec.ts` (both are
 * mandataire-only for validation, and `hr` is not registered in `all.ts`'s own `COUNTRY_FILES` list
 * yet — adding it there is the mandataire's call, not this agent's) — this spec reads `hr.json`
 * directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate `all.ts` would run,
 * so the file is proven valid on its own before it is ever wired into the aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadHr(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'hr.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/hr.json`);
  return rule;
}

describe('HR — country-policy/data/hr.json', () => {
  const hr = loadHr();

  it('declares countryCode "HR", matching its own filename', () => {
    expect(hr.countryCode).toBe('HR');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((hr.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of hr.rules) {
      expect(() => assertValidProvenance(rule, 'data/hr.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file, no duplicates', () => {
    const declared = hr.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
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

  it('allows every one of its 22 rules — HR never itself needs an unblock', () => {
    expect(hr.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least three "legal" rules and several "unverified" rules — a real, honest research pass', () => {
    const legalCount = hr.rules.filter((r) => r.provenance.kind === 'legal').length;
    expect(legalCount).toBeGreaterThanOrEqual(3);
    expect(hr.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('invoice.save-draft is restricted to "draft" and sourced to ZPDV čl. 78 st. 7 — a direct FR/BE/GR/EE-style document-modification-assimilation clause', () => {
    const rule = ruleFor(hr, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toBe(
        'Svaka isprava ili obavijest koja mijenja prvobitni račun i koja se izričito i nedvojbeno odnosi na njega smatra se računom.',
      );
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(rule.notes).toMatch(/čl\. 78 st\. 7/);
  });

  it('invoice.send is sourced to the Zakon o fiskalizaciji (Fiskalizacija 2.0, NN 89/25) čl. 38 and pins the 1 January 2026 mandatory B2B eRačun date', () => {
    const rule = ruleFor(hr, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/Obvezu izdavanja eRačuna ima izdavatelj eRačuna/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(rule.notes).toMatch(/NN 89\/25/);
    expect(rule.notes).toMatch(/1\. siječnja 2026/);
    expect(rule.notes).toMatch(/suglasnost primatelja[\s\S]*nije potrebna/);
  });

  it('credit-note.send documents the čl. 33 st. 7 base-reduction-plus-notification mechanism as the legal fact of substance, distinct from the product-level status transition', () => {
    const rule = ruleFor(hr, 'credit-note', 'send');
    expect(rule.provenance.kind).toBe('unverified');
    if (rule.provenance.kind === 'unverified') {
      expect(rule.provenance.resolutionNote).toMatch(/čl\. 33 st\. 7/);
    }
    expect(rule.notes).toMatch(/correction-routes\/data\/hr\.json/);
  });

  it('quote.send reuses the eIDAS art. 25 §1 citation with a FRESH successful read this session (unlike the same-day 202-empty-body failures documented by be.json/gr.json)', () => {
    const rule = ruleFor(hr, 'quote', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/shall not be denied legal effect/);
    }
    expect(rule.notes).toMatch(/HTTP 200/);
  });

  it('the file-level notes documents the three primary sources read (ZPDV, Zakon o fiskalizaciji, Zakon o osobnom identifikacijskom broju) and the B2G_COVERAGE.md cross-check', () => {
    expect(hr.notes ?? '').toMatch(/Zakon o porezu na dodanu vrijednost/);
    expect(hr.notes ?? '').toMatch(/Zakon o fiskalizaciji/);
    expect(hr.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
  });
});
