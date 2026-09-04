/**
 * IE — direct-load content spec, added by the IE country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as country-policy/data/se.spec.ts: reads `ie.json` straight off disk rather than
 * through `data/all.ts` (still FR/US/HU/DE/IT/PL/ES/MX/EE/GR/CY/LV/LU/MT/SE only — wiring "ie" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadIe(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'ie.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('IE — country-policy/data/ie.json', () => {
  const ie = loadIe();

  it('declares countryCode IE and a non-empty documentTypes list', () => {
    expect(ie.countryCode).toBe('IE');
    expect(ie.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of ie.rules) {
      expect(() => assertValidProvenance(rule, 'ie.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/se.json/mt.json, no duplicates', () => {
    const pairs = ie.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in a TWO-clause composition (Reg. 20(2)(b) unique sequence number + VATCA s. 66(2A)(a) authenticity/integrity/audit trail)', () => {
    const saveDraft = ie.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        'a sequential number, based on one or more series, which uniquely identifies the invoice',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/66\(2A\)\(a\)/);
    expect(saveDraft.notes).toMatch(/authenticity of the origin/);
  });

  it('pins invoice.send: "legal", VATCA s. 66(2)(a) — electronic invoicing gated on PRIOR AGREEMENT between issuer and recipient (Ireland\'s own wording, distinct from FR/DE/NL/SE/MT\'s "acceptance"/"consent")', () => {
    const send = ie.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'each such invoice or other document is issued and received by prior agreement between the person who issues the invoice or other document and the person who is in receipt of that invoice or document',
      );
      expect(send.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(send.notes).toMatch(/PRIOR AGREEMENT/);
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation SE/MT/LV/NL/DE/IT/ES/PL/EE already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = ie.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is "legal", grounded in the strongest citation of the whole catalog: VATCA s. 67(1)(b)(i) NAMES AND DEFINES the "credit note" INSIDE its own mandatory-issuance clause', () => {
    const creditSend = ie.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'the person shall issue to that other person a document (in this Act referred to as a "credit note") containing particulars of the reduction or discount in such form and containing such other particulars as may be specified by regulations',
      );
    }
    expect(creditSend.notes).toMatch(/67\(1\)\(b\)\(i\)/);
  });

  it('the file-level notes flag the "debit note" false friend (VATCA s. 67(2) does NOT increase the amount due) so a future reader never conflates it with the DEBIT_NOTE correction route', () => {
    expect(ie.notes).toMatch(/FAUX-AMI/);
    expect(ie.notes).toMatch(/67\(2\)/);
    expect(ie.notes).toMatch(/67\(1\)\(a\)/);
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = ie.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });

  it('invoice.record-payment stays "unverified" but cross-references the bad-debt finding pinned in correction-routes/data/ie.json (Reg. 10 + Reg. 27(1)(m))', () => {
    const recordPayment = ie.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'record-payment')!;
    expect(recordPayment.provenance.kind).toBe('unverified');
    if (recordPayment.provenance.kind === 'unverified') {
      expect(recordPayment.provenance.resolutionNote).toMatch(/regulation 10/i);
      expect(recordPayment.provenance.resolutionNote).toMatch(/Regulation 27\(1\)\(m\)/);
      expect(recordPayment.provenance.resolutionNote).toMatch(/LEDGER_ANNOTATION/);
    }
  });
});
