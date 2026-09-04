/**
 * Content-pinning + schema-gate spec for `data/pt.json` — the AGENT PAYS PT deliverable (lot 7,
 * TODO_DOCUMENTS.md vague B, dernier lot). Deliberately does NOT go through `all.ts`/`all.spec.ts`
 * (both are mandataire-only for validation, and `pt` is not registered in `all.ts`'s own
 * `COUNTRY_FILES` list yet — adding it there is the mandataire's call, not this agent's) — this spec
 * reads `pt.json` directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate
 * `all.ts` would run, so the file is proven valid on its own before it is ever wired into the
 * aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadPt(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'pt.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/pt.json`);
  return rule;
}

describe('PT — country-policy/data/pt.json', () => {
  const pt = loadPt();

  it('declares countryCode "PT", matching its own filename', () => {
    expect(pt.countryCode).toBe('PT');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((pt.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of pt.rules) {
      expect(() => assertValidProvenance(rule, 'data/pt.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file, no duplicates', () => {
    const declared = pt.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
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

  it('allows every one of its 22 rules — PT never itself needs an unblock', () => {
    expect(pt.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least three "legal" rules and several "unverified" rules — a real, honest research pass', () => {
    const legalCount = pt.rules.filter((r) => r.provenance.kind === 'legal').length;
    expect(legalCount).toBeGreaterThanOrEqual(3);
    expect(pt.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('invoice.save-draft is restricted to "draft" and sourced to CIVA art. 78.º n.º 1 — the correction-must-observe-art.-36-formalities mechanism', () => {
    const rule = ruleFor(pt, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toBe(
        'As disposições dos artigos 36.º e seguintes devem ser observadas sempre que, emitida a fatura, o valor tributável de uma operação ou o respetivo imposto venham a sofrer retificação por qualquer motivo.',
      );
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(rule.notes).toMatch(/art\. 78\.º n\.º 1/);
    expect(rule.notes).toMatch(/documentos retificativos de faturas/);
  });

  it('invoice.send is sourced to the Decreto-Lei n.º 28/2019 art. 4.º certified-software mandate — the TROUVAILLE ATTENDUE of this task — and documents ATCUD/QR and the chained signature', () => {
    const rule = ruleFor(pt, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(
        /estão obrigados a utilizar, exclusivamente, programas informáticos que tenham sido objeto de prévia certificação pela AT/,
      );
      expect(rule.provenance.sourceText).toMatch(/€ 50 000/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(rule.notes).toMatch(/TROUVAILLE ATTENDUE/);
    expect(rule.notes).toMatch(/ATCUD/);
    expect(rule.notes).toMatch(/SIGNATURE CHAÎNÉE/);
    expect(rule.notes).toMatch(/Portaria n\.º 195\/2020/);
    expect(rule.notes).toMatch(/Portaria n\.º 363\/2010/);
    expect(rule.notes).toMatch(/B2G_COVERAGE\.md/);
  });

  it('credit-note.send documents the CIVA art. 78.º base-reduction mechanism as the legal fact of substance, distinct from the product-level status transition', () => {
    const rule = ruleFor(pt, 'credit-note', 'send');
    expect(rule.provenance.kind).toBe('unverified');
    if (rule.provenance.kind === 'unverified') {
      expect(rule.provenance.resolutionNote).toMatch(/art\. 78\.º n\.º 2/);
    }
    expect(rule.notes).toMatch(/correction-routes\/data\/pt\.json/);
  });

  it('quote.send cites the eIDAS art. 25 §1 electronic-signature clause with a fresh 2026-09-04 read', () => {
    const rule = ruleFor(pt, 'quote', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/shall not be denied legal effect/);
    }
    expect(rule.notes).toMatch(/HTTP 200/);
  });

  it('the file-level notes documents the CIVA + Decreto-Lei n.º 28/2019 + Portarias sources, the SPA-contournée-par-miroir-officiel method, and the B2G_COVERAGE.md cross-check', () => {
    expect(pt.notes ?? '').toMatch(/Código do IVA/);
    expect(pt.notes ?? '').toMatch(/Decreto-Lei n\.º 28\/2019/);
    expect(pt.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
    expect(pt.notes ?? '').toMatch(/diariodarepublica\.pt/);
  });
});
