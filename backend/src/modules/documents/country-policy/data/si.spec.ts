/**
 * Content-pinning + schema-gate spec for `data/si.json` — the AGENT PAYS SI deliverable (lot 7,
 * TODO_DOCUMENTS.md vague B, dernier lot). Deliberately does NOT go through `all.ts`/`all.spec.ts`
 * (both are mandataire-only for validation, and `si` is not registered in `all.ts`'s own
 * `COUNTRY_FILES` list yet — adding it there is the mandataire's call, not this agent's) — this spec
 * reads `si.json` directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate
 * `all.ts` would run, so the file is proven valid on its own before it is ever wired into the
 * aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadSi(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'si.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/si.json`);
  return rule;
}

describe('SI — country-policy/data/si.json', () => {
  const si = loadSi();

  it('declares countryCode "SI", matching its own filename', () => {
    expect(si.countryCode).toBe('SI');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((si.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of si.rules) {
      expect(() => assertValidProvenance(rule, 'data/si.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file, no duplicates', () => {
    const declared = si.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
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

  it('allows every one of its 22 rules — SI never itself needs an unblock', () => {
    expect(si.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least three "legal" rules and several "unverified" rules — a real, honest research pass', () => {
    const legalCount = si.rules.filter((r) => r.provenance.kind === 'legal').length;
    expect(legalCount).toBeGreaterThanOrEqual(3);
    expect(si.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('invoice.save-draft is restricted to "draft" and sourced to ZDDV-1 81. člen, deveti odstavek — a direct FR/BE/GR/EE/HR-style document-modification-assimilation clause', () => {
    const rule = ruleFor(si, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toBe(
        'Kot račun se šteje tudi vsak dokument oziroma sporočilo, ki spreminja prvoten račun in se nanj nedvoumno nanaša.',
      );
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(rule.notes).toMatch(/81\. člen/);
    expect(rule.notes).toMatch(/deveti odstavek/);
  });

  it('invoice.send is sourced to ZDDV-1 81. člen and documents the CURRENT consent regime (84. člen) plus the ZIERDED B2B mandate as VOTED (Uradni list RS 85\\/25) but not yet applicable (1 January 2028)', () => {
    const rule = ruleFor(si, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/Vsak davčni zavezanec mora zagotoviti/);
    }
    expect(rule.notes).toMatch(/Prejemnik računa se mora strinjati z uporabo elektronskega računa/);
    expect(rule.notes).toMatch(/ZIERDED/);
    expect(rule.notes).toMatch(/85\/25/);
    expect(rule.notes).toMatch(/23 octobre 2025/);
    expect(rule.notes).toMatch(/6 novembre 2025/);
    expect(rule.notes).toMatch(/1er JANVIER 2028/);
    expect(rule.notes).toMatch(/Veljaven predpis, ki se še ne uporablja/);
    expect(rule.notes).toMatch(/1er avril 2027/);
  });

  it('credit-note.send documents the ZDDV-1 39. člen base-reduction-plus-written-notice mechanism as the legal fact of substance, distinct from the product-level status transition', () => {
    const rule = ruleFor(si, 'credit-note', 'send');
    expect(rule.provenance.kind).toBe('unverified');
    if (rule.provenance.kind === 'unverified') {
      expect(rule.provenance.resolutionNote).toMatch(/39\. člen/);
      expect(rule.provenance.resolutionNote).toMatch(/dobropis/);
    }
    expect(rule.notes).toMatch(/correction-routes\/data\/si\.json/);
  });

  it('quote.send reuses the eIDAS art. 25 §1 citation with a FRESH successful read this session', () => {
    const rule = ruleFor(si, 'quote', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/shall not be denied legal effect/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(rule.notes).toMatch(/HTTP 200/);
  });

  it('received-invoice.reject documents the ZIERDED rejection-message CAPABILITY as a real but inconclusive finding, distinct from this purely internal action', () => {
    const rule = ruleFor(si, 'received-invoice', 'reject');
    expect(rule.provenance.kind).toBe('unverified');
    if (rule.provenance.kind === 'unverified') {
      expect(rule.provenance.resolutionNote).toMatch(/ZAVRNITVI/);
      expect(rule.provenance.resolutionNote).toMatch(/COUNTERPARTY_OBJECTION/);
    }
  });

  it('the file-level notes documents the two primary sources read (ZDDV-1, ZIERDED), the PISRS SPA/API access method, and the B2G_COVERAGE.md cross-check', () => {
    expect(si.notes ?? '').toMatch(/Zakon o davku na dodano vrednost/);
    expect(si.notes ?? '').toMatch(/ZIERDED/);
    expect(si.notes ?? '').toMatch(/pisrs\.si/);
    expect(si.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
  });
});
