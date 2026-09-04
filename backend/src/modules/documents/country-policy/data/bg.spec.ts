/**
 * BG — direct-load content spec, added by the BG country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as country-policy/data/se.spec.ts: reads `bg.json` straight off disk rather than
 * through `data/all.ts` (wiring "bg" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadBg(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'bg.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('BG — country-policy/data/bg.json', () => {
  const bg = loadBg();

  it('declares countryCode BG and a non-empty documentTypes list', () => {
    expect(bg.countryCode).toBe('BG');
    expect(bg.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of bg.rules) {
      expect(() => assertValidProvenance(rule, 'bg.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as gr.json/cy.json, no duplicates', () => {
    const pairs = bg.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in чл. 116, ал. 1 — a FRONTAL prohibition on rewriting an issued invoice (not a mere assimilation clause like gr.json\'s own art. 8 § 3)', () => {
    const saveDraft = bg.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      // Tripwire: the FULL two-sentence citation, not a truncated fragment — omitting the second
      // sentence would silently drop the "cancel + reissue" half of the rule.
      expect(saveDraft.provenance.sourceText).toBe(
        'Поправки и добавки във фактурите и известията към тях не се разрешават. Погрешно съставени или поправени документи се анулират и се издават нови.',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/чл\. 116/);
  });

  it('pins invoice.send: "legal", ЗДДС чл. 113 ал. 1 (issuance duty) composed with чл. 114 ал. 9 (electronic form conditioned on WRITTEN OR TACIT consent)', () => {
    const send = bg.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toMatch(/е длъжно да издаде фактура/);
      // The distinctive tripwire fragment for this rule: "written OR TACIT consent" — dropping
      // "мълчаливо" (tacit) would silently promote BG to a stricter written-only regime.
      expect(send.provenance.sourceText).toMatch(/писмено или мълчаливо съгласие/);
      expect(send.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation gr.json/cy.json already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = bg.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send stays "unverified" at the product-action level despite a real legal INJUNCTION (чл. 115, ал. 1 — "длъжен да издаде") grounding the underlying document, exactly like gr.json/cy.json\'s own credit-note.send', () => {
    const creditSend = bg.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.allowed).toBe(true);
    expect(creditSend.provenance.kind).toBe('unverified');
    if (creditSend.provenance.kind === 'unverified') {
      expect(creditSend.provenance.resolutionNote).toMatch(/длъжен да издаде известие/);
    }
    expect(creditSend.notes).toMatch(/correction-routes\/data\/bg\.json/);
    expect(creditSend.notes).toMatch(/required/);
  });

  it('invoice.download-xml stays "unverified" and references B2G_COVERAGE.md\'s own no-Peppol finding for BG (CAIS EPP, closed channel)', () => {
    const downloadXml = bg.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'download-xml')!;
    expect(downloadXml.provenance.kind).toBe('unverified');
    if (downloadXml.provenance.kind === 'unverified') {
      expect(downloadXml.provenance.resolutionNote).toMatch(/CAIS EPP/);
      expect(downloadXml.provenance.resolutionNote).toMatch(/B2G_COVERAGE\.md/);
    }
  });

  it('received-invoice.reject cites the negative textual search on "оспорва"/"възразява" also documented in correction-routes/data/bg.json\'s own COUNTERPARTY_OBJECTION', () => {
    const reject = bg.rules.find((r) => r.typeId === 'received-invoice' && r.actionId === 'reject')!;
    expect(reject.provenance.kind).toBe('unverified');
    if (reject.provenance.kind === 'unverified') {
      expect(reject.provenance.resolutionNote).toMatch(/оспорва/);
      expect(reject.provenance.resolutionNote).toMatch(/COUNTERPARTY_OBJECTION/);
    }
  });

  it("file-level notes name the primary source (ЗДДС, lex.bg raw text) and explicitly document lex.bg's own search backend being non-functional this session", () => {
    expect(bg.notes).toMatch(/lex\.bg/);
    expect(bg.notes).toMatch(/windows-1251/);
    expect(bg.notes).toMatch(/NE FONCTIONNEL|non fonctionnel/i);
  });

  it("no rule ever claims a b2g-routing/data/bg.json file exists — the closed CAIS EPP channel stays an honest gap, per this agent's strict scope", () => {
    for (const rule of bg.rules) {
      expect(rule.notes ?? '').not.toMatch(/b2g-routing\/data\/bg\.json/);
    }
    expect(bg.notes).toMatch(/AUCUN b2g-routing\/data\/bg\.json/);
  });
});
