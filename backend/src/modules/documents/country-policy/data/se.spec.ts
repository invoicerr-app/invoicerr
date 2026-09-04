/**
 * SE — direct-load content spec, added by the SE country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as country-policy/data/lv.spec.ts: reads `se.json` straight off disk rather than
 * through `data/all.ts` (still FR/US/HU/DE/IT/PL/ES/MX/EE/GR/CY/LV/LU only — wiring "se" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadSe(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'se.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('SE — country-policy/data/se.json', () => {
  const se = loadSe();

  it('declares countryCode SE and a non-empty documentTypes list', () => {
    expect(se.countryCode).toBe('SE');
    expect(se.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of se.rules) {
      expect(() => assertValidProvenance(rule, 'se.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/lv.json/lu.json, no duplicates', () => {
    const pairs = se.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in a TWO-clause composition (17 kap. 24 §2 unique sequence number + 17 kap. 30 § authenticity/integrity)', () => {
    const saveDraft = se.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        'ett löpnummer baserat på en eller flera serier, som unikt identifierar fakturan',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/17 kap\. 30 §/);
  });

  it('pins invoice.send: "legal", Mervärdesskattelag 17 kap. 20 § — electronic invoicing subject to recipient consent', () => {
    const send = se.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'Elektronisk faktura får utfärdas bara om mottagaren godkänner det.',
      );
    }
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation LV/LU/NL/DE/IT/ES/PL/EE already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = se.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is promoted to "legal" (unlike nl.json\'s own credit-note.send) via 17 kap. 22 §\'s general document-deemed-equivalent clause composed with 17 kap. 20 §, reinforced by the MANDATORY 17 kap. 23 §', () => {
    const creditSend = se.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'Varje handling eller meddelande med ändring av den ursprungliga fakturan och med en särskild och otvetydig hänvisning till den ursprungliga fakturan likställs med en faktura.',
      );
    }
    expect(creditSend.notes).toMatch(/17 kap\. 23 §/);
    expect(creditSend.notes).toMatch(/required/);
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = se.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });

  it('file-level notes flag the Mervärdesskattelagen (2023:200) as a REPLACEMENT of the old 1994:200 act — mentioned only to say it is never the source', () => {
    expect(se.notes).toMatch(/2023:200/);
    expect(se.notes).toMatch(/1994:200/);
    // no rule's own sourceText/notes ever cites a §/al./kap. of the repealed 1994:200 act as its basis
    for (const rule of se.rules) {
      if (rule.provenance.kind === 'legal') {
        expect(rule.provenance.sourceText).not.toMatch(/1994:200/);
      }
      expect(rule.notes ?? '').not.toMatch(/1994:200 §/);
    }
  });
});
