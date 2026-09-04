/**
 * Content-pinning + schema-gate spec for `data/ro.json` — the AGENT PAYS RO deliverable (lot 7,
 * TODO_DOCUMENTS.md vague B, last of the lot). Deliberately does NOT go through `all.ts`/`all.spec.ts`
 * (both are mandataire-only for validation, and `ro` is not registered in `all.ts`'s own
 * `COUNTRY_FILES` list yet — adding it there is the mandataire's call, not this agent's) — this spec
 * reads `ro.json` directly with `readFileSync` and re-runs the SAME `assertValidProvenance` gate
 * `all.ts` would run, so the file is proven valid on its own before it is ever wired into the
 * aggregator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile, DocumentActionRuleFact } from '../schema';

function loadRo(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'ro.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

function ruleFor(file: CountryDocumentPolicyFile, typeId: string, actionId: string): DocumentActionRuleFact {
  const rule = file.rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) throw new Error(`No rule for ${typeId}.${actionId} in data/ro.json`);
  return rule;
}

describe('RO — country-policy/data/ro.json', () => {
  const ro = loadRo();

  it('declares countryCode "RO", matching its own filename', () => {
    expect(ro.countryCode).toBe('RO');
  });

  it('declares the same five document types every other shipped country does', () => {
    expect((ro.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('every rule passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const rule of ro.rules) {
      expect(() => assertValidProvenance(rule, 'data/ro.json')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId::actionId pairs as the FR reference file, no duplicates', () => {
    const declared = ro.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
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

  it('allows every one of its 22 rules — RO never itself needs an unblock', () => {
    expect(ro.rules.filter((r) => !r.allowed)).toEqual([]);
  });

  it('has at least three "legal" rules and several "unverified" rules — a real, honest research pass', () => {
    const legalCount = ro.rules.filter((r) => r.provenance.kind === 'legal').length;
    expect(legalCount).toBeGreaterThanOrEqual(3);
    expect(ro.rules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  it('invoice.save-draft is restricted to "draft" and sourced to Codul fiscal art. 319 alin. (2) — a direct FR/BE/GR/EE/HR-style document-modification-assimilation clause', () => {
    const rule = ruleFor(ro, 'invoice', 'save-draft');
    expect(rule.statuses).toEqual(['draft']);
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toBe(
        'Orice document sau mesaj care modifică şi care se referă în mod specific şi fără ambiguităţi la factura iniţială are acelaşi regim juridic ca o factură.',
      );
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(rule.notes).toMatch(/art\. 319 alin\. \(2\)/);
  });

  it('invoice.send is sourced to OUG 120/2021 art. 10 alin. (1) (as rewritten by OUG 115/2023) and pins the 1 July 2024 permanent-mandate date, distinct from the 1 January 2024 transitional one', () => {
    const rule = ruleFor(ro, 'invoice', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(
        /emitentul facturii electronice are obligaţia de transmitere/,
      );
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(rule.notes).toMatch(/OUG 115\/2023/);
    expect(rule.notes).toMatch(/1 IULIE 2024/i);
    expect(rule.notes).toMatch(/Legea nr\. 296\/2023/);
    expect(rule.notes).toMatch(/2024-01-01/);
  });

  it("invoice.send's notes flag the unresolved discrepancy with documentation/compliance/RO-Romania.md's own claimed 2026 working-days deadline change, without editing that file", () => {
    const rule = ruleFor(ro, 'invoice', 'send');
    expect(rule.notes).toMatch(/RO-Romania\.md/);
    expect(rule.notes).toMatch(/CALENDARISTICE/);
  });

  it('credit-note.send documents the art. 330 alin. (2) mandatory-issuance mechanism as the legal fact of substance, distinct from the product-level status transition', () => {
    const rule = ruleFor(ro, 'credit-note', 'send');
    expect(rule.provenance.kind).toBe('unverified');
    if (rule.provenance.kind === 'unverified') {
      expect(rule.provenance.resolutionNote).toMatch(/art\. 330 alin\. \(2\)/);
      expect(rule.provenance.resolutionNote).toMatch(/'required'/);
    }
    expect(rule.notes).toMatch(/correction-routes\/data\/ro\.json/);
  });

  it('quote.send is sourced to a FRESH eIDAS art. 25 §1 read this session (2026-09-05)', () => {
    const rule = ruleFor(ro, 'quote', 'send');
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/shall not be denied legal effect/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(rule.notes).toMatch(/HTTP 200/);
  });

  it("received-invoice.reject documents the negative keyword search (resping/refuz) against the RO e-Factura mandate texts, consistent with correction-routes/data/ro.json's own COUNTERPARTY_OBJECTION finding", () => {
    const rule = ruleFor(ro, 'received-invoice', 'reject');
    expect(rule.provenance.kind).toBe('unverified');
    if (rule.provenance.kind === 'unverified') {
      expect(rule.provenance.resolutionNote).toMatch(/COUNTERPARTY_OBJECTION/);
    }
  });

  it('the file-level notes documents the six primary sources read (Codul fiscal, OUG 120/2021, Legea 296/2023, OUG 115/2023, OUG 69/2024, eIDAS) and the legislatie.just.ro access failure', () => {
    expect(ro.notes ?? '').toMatch(/Legea nr\. 227\/2015/);
    expect(ro.notes ?? '').toMatch(/OUG_120_2021/);
    expect(ro.notes ?? '').toMatch(/OUG_115_2023/);
    expect(ro.notes ?? '').toMatch(/OUG_69_2024/);
    expect(ro.notes ?? '').toMatch(/legislatie\.just\.ro/);
    expect(ro.notes ?? '').toMatch(/static\.anaf\.ro/);
  });
});
