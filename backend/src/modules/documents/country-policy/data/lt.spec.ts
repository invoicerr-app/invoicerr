/**
 * LT — direct-load content spec, added by the LT country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as country-policy/data/ee.spec.ts: reads `lt.json` straight off disk rather than
 * through `data/all.ts` (still FR/US/HU/DE/IT/PL/ES/MX only — wiring "lt" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadLt(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'lt.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('LT — country-policy/data/lt.json', () => {
  const lt = loadLt();

  it('declares countryCode LT and a non-empty documentTypes list', () => {
    expect(lt.countryCode).toBe('LT');
    expect(lt.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of lt.rules) {
      expect(() => assertValidProvenance(rule, 'lt.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/ee.json, no duplicates', () => {
    const pairs = lt.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in PVMĮ art. 80(1)(2) — series and number', () => {
    const saveDraft = lt.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        '2) PVM sąskaitos faktūros serija ir numeris, leidžiantys identifikuoti PVM sąskaitą faktūrą;',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('pins invoice.send: "legal", PVMĮ art. 79(11) — electronic VAT invoice subject to prior buyer consent', () => {
    const send = lt.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toMatch(/Elektroninė PVM sąskaita faktūra/);
      expect(send.provenance.sourceText).toMatch(/išankstinis pirkėjo sutikimas/);
    }
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation EE/GR/NL already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = lt.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send stays "unverified" at the product-action level despite a real "legal"/"required" fact backing the underlying kreditinis dokumentas (see correction-routes/data/lt.json)', () => {
    const creditSend = lt.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('unverified');
    if (creditSend.provenance.kind === 'unverified') {
      expect(creditSend.provenance.resolutionNote).toMatch(/PVMĮ art\. 83/);
      expect(creditSend.provenance.resolutionNote).toMatch(/correction-routes\/data\/lt\.json/);
    }
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = lt.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });
});
