/**
 * MT — direct-load content spec, added by the MT country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as country-policy/data/lv.spec.ts: reads `mt.json` straight off disk rather than
 * through `data/all.ts` (still FR/US/HU/DE/IT/PL/ES/MX/EE/GR/CY/LV/LU only — wiring "mt" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadMt(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'mt.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('MT — country-policy/data/mt.json', () => {
  const mt = loadMt();

  it('declares countryCode MT and a non-empty documentTypes list', () => {
    expect(mt.countryCode).toBe('MT');
    expect(mt.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of mt.rules) {
      expect(() => assertValidProvenance(rule, 'mt.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/lv.json/ee.json, no duplicates', () => {
    const pairs = mt.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in a TWO-clause composition (Twelfth Schedule item 3(b) sequence number + item 6(3) constant content)', () => {
    const saveDraft = mt.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        'a sequential number, based on one or more series, which uniquely identifies the invoice',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/item 6\(3\)/);
  });

  it('pins invoice.send: "legal", Twelfth Schedule item 6(2) — electronic invoicing subject to recipient acceptance', () => {
    const send = mt.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'The use of an electronic invoice shall be subject to acceptance by the recipient.',
      );
    }
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation NL/DE/IT/ES/PL/EE/LV already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = mt.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is promoted to "legal" via the Twelfth Schedule item 1(2) document-deemed-equivalent clause, reinforced by the NAMED "credit notes"/"debit notes" recognition absent from lv.json/ee.json', () => {
    const creditSend = mt.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'Any document or message that amends and refers specifically and unambiguously to the initial invoice shall be treated as an invoice.',
      );
    }
    expect(creditSend.notes).toMatch(/Eleventh Schedule/);
    expect(creditSend.notes).toMatch(/CREDIT NOTES/);
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = mt.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });
});
