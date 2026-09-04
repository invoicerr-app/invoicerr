/**
 * Content-pinning + schema-gate spec for `data/at.json` — the AGENT PAYS AT deliverable (lot 1,
 * TODO_DOCUMENTS.md vague B). Deliberately does NOT go through `all.ts`/`all.spec.ts` (both are
 * mandataire-only for validation, and `at` is not registered in `all.ts`'s own `COUNTRY_FILES` list
 * yet — adding it there is the mandataire's call, not this agent's) — this spec reads `at.json`
 * directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate `all.ts` would run,
 * so the file is proven valid on its own before it is ever wired into the aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadAt(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'at.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/at.json`);
  return rule;
}

describe('AT — country-policy/data/at.json', () => {
  const at = loadAt();

  it('declares countryCode "AT", matching its own filename', () => {
    expect(at.countryCode).toBe('AT');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((at.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of at.rules) {
      expect(() => assertValidProvenance(rule, 'data/at.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file', () => {
    const declared = at.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
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

  it('allows every one of its 22 rules — AT never itself needs an unblock', () => {
    expect(at.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least one "legal" and several "unverified" rules — a real, honest research pass', () => {
    expect(at.rules.some((r) => r.provenance.kind === 'legal')).toBe(true);
    expect(at.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('invoice.save-draft is restricted to "draft" and sourced to UStG 1994 §16 (temporal correction principle)', () => {
    const rule = ruleFor(at, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    expect((rule.provenance as { sourceText: string }).sourceText).toMatch(/Bemessungsgrundlage/);
    expect(rule.notes).toMatch(/§16/);
  });

  it('invoice.send is sourced to UStG 1994 §11 Abs. 2 (elektronische Rechnung, recipient consent)', () => {
    const rule = ruleFor(at, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    const sourceText = (rule.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/elektronische Rechnung/);
    expect(sourceText).toMatch(/Empfänger/);
    expect(rule.notes).toMatch(/§11 Abs\. 2/);
  });

  it('every credit-note rule explicitly documents the Gutschrift (self-billing) vs avoir false-friend', () => {
    for (const actionId of ['save-draft', 'send', 'share-link']) {
      const rule = ruleFor(at, 'credit-note', actionId);
      const text =
        rule.provenance.kind === 'legal' ? rule.provenance.sourceText : rule.provenance.resolutionNote;
      expect(text + (rule.notes ?? '')).toMatch(/Gutschrift/);
    }
  });

  it('the file-level notes documents the RIS access wall and the jusline.at mirror used instead', () => {
    expect(at.notes ?? '').toMatch(/ris\.bka\.gv\.at/);
    expect(at.notes ?? '').toMatch(/jusline\.at/);
  });
});
