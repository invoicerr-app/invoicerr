/**
 * LV — direct-load content spec, added by the LV country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as country-policy/data/ee.spec.ts: reads `lv.json` straight off disk rather than
 * through `data/all.ts` (still FR/US/HU/DE/IT/PL/ES/MX/EE/GR/CY only — wiring "lv" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadLv(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'lv.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('LV — country-policy/data/lv.json', () => {
  const lv = loadLv();

  it('declares countryCode LV and a non-empty documentTypes list', () => {
    expect(lv.countryCode).toBe('LV');
    expect(lv.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of lv.rules) {
      expect(() => assertValidProvenance(rule, 'lv.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/nl.json/ee.json, no duplicates', () => {
    const pairs = lv.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in a TWO-clause composition (art. 125(1)(2) sequence number + art. 125(3) constant content)', () => {
    const saveDraft = lv.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        'the sequence number of one or several series of the tax invoice which provides a unique identification of the tax invoice',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/art\. 125 al\. 3/);
  });

  it('pins invoice.send: "legal", Pievienotās vērtības nodokļa likums art. 132(1) — electronic invoicing subject to recipient recognition', () => {
    const send = lv.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'A registered taxable person is entitled to issue (draw up) and deliver a tax invoice by electronic means only when the a recipient of such tax invoice recognises such form of the tax invoice.',
      );
    }
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation NL/DE/IT/ES/PL/EE already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = lv.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is promoted to "legal" (unlike nl.json\'s own credit-note.send) via art. 125(5)\'s general document-deemed-equivalent clause composed with art. 132(1)', () => {
    const creditSend = lv.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'Any document which amends the initial tax invoice or especially and clearly indicates thereto shall be regarded as equivalent to the tax invoice if it conforms to the requirements laid down in Paragraph one of this Section.',
      );
    }
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = lv.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });
});
