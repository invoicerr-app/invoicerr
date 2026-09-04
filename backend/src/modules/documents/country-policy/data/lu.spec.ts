/**
 * Content-pinning + schema-gate spec for `data/lu.json` — the AGENT PAYS LUXEMBOURG (LU) deliverable
 * (lot 3, TODO_DOCUMENTS.md vague B). Deliberately does NOT go through `all.ts`/`all.spec.ts` (both
 * are mandataire-only for validation, and `lu` is not registered in `all.ts`'s own `COUNTRY_FILES`
 * list yet — adding it there is the mandataire's call, not this agent's) — this spec reads `lu.json`
 * directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate `all.ts` would run,
 * so the file is proven valid on its own before it is ever wired into the aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadLu(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'lu.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/lu.json`);
  return rule;
}

describe('LU — country-policy/data/lu.json', () => {
  const lu = loadLu();

  it('declares countryCode "LU", matching its own filename', () => {
    expect(lu.countryCode).toBe('LU');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((lu.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of lu.rules) {
      expect(() => assertValidProvenance(rule, 'data/lu.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file, no duplicates', () => {
    const declared = lu.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
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

  it('allows every one of its 22 rules — LU never itself needs an unblock', () => {
    expect(lu.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least three "legal" rules and several "unverified" rules — a real, honest research pass', () => {
    const legalCount = lu.rules.filter((r) => r.provenance.kind === 'legal').length;
    expect(legalCount).toBeGreaterThanOrEqual(3);
    expect(lu.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('quote.send is freshly re-verified against eIDAS art. 25 §1 in French, not merely a reused English quote', () => {
    const rule = ruleFor(lu, 'quote', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/recevabilité d'une signature électronique/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('invoice.save-draft is restricted to "draft" and sourced to LTVA art. 63 §2 al. 2 — the general document-modification-assimilation clause', () => {
    const rule = ruleFor(lu, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/assimilé à une facture/);
    }
    expect(rule.notes).toMatch(/art\. 63 § 2/);
  });

  it('invoice.send is sourced to LTVA art. 63 §13 and documents the consent-based regime (opt-in), distinct from the mandatory Peppol B2G channel', () => {
    const rule = ruleFor(lu, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/soumise à l'acceptation du destinataire/);
    }
    expect(rule.notes).toMatch(/b2g-routing/);
  });

  it('credit-note.send documents the general LTVA assimilation clause as a real legal fact without promoting the product-level status transition itself to "legal"', () => {
    const rule = ruleFor(lu, 'credit-note', 'send');
    expect(rule.provenance.kind).toBe('unverified');
    expect(rule.notes).toMatch(/art\. 63 § 2/);
  });

  it('the file-level notes documents the legilux SPARQL access method and the successful eur-lex re-verification', () => {
    expect(lu.notes ?? '').toMatch(/sparqlendpoint|SPARQL/);
    expect(lu.notes ?? '').toMatch(/eur-lex\.europa\.eu/);
  });
});
