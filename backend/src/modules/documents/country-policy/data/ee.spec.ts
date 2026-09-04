/**
 * EE — direct-load content spec, added by the EE country agent (TODO_DOCUMENTS.md, vague B, lot 2).
 * Same rationale as country-policy/data/nl.spec.ts: reads `ee.json` straight off disk rather than
 * through `data/all.ts` (still FR/US/HU/DE/IT/PL/ES/MX only — wiring "ee" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadEe(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'ee.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('EE — country-policy/data/ee.json', () => {
  const ee = loadEe();

  it('declares countryCode EE and a non-empty documentTypes list', () => {
    expect(ee.countryCode).toBe('EE');
    expect(ee.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of ee.rules) {
      expect(() => assertValidProvenance(rule, 'ee.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/nl.json, no duplicates', () => {
    const pairs = ee.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in a TWO-clause composition (§ 37(7)(1) numbering + § 36(1)(1) preservation in original form)', () => {
    const saveDraft = ee.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe('the serial number and date of issue of the invoice');
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/§ 36\(1\)\(1\)/);
  });

  it('pins invoice.send: "legal", Käibemaksuseadus § 37(6) — electronic invoicing subject to buyer acceptance', () => {
    const send = ee.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'An invoice may be issued on paper or, subject to acceptance by the acquirer of goods or the recipient of services, by electronic means.',
      );
    }
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation NL/DE/IT/ES/PL already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = ee.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is promoted to "legal" (unlike nl.json\'s own credit-note.send) via § 37(4)\'s general document-deemed-an-invoice clause composed with § 37(6)', () => {
    const creditSend = ee.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'A document, including a credit invoice, which amends an initial invoice and which contains a reference to the initial invoice shall be deemed to be an invoice.',
      );
    }
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = ee.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });
});
