/**
 * CZ — direct-load content spec, added by the CZ country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as country-policy/data/ie.spec.ts: reads `cz.json` straight off disk rather than
 * through `data/all.ts` (wiring "cz" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadCz(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'cz.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('CZ — country-policy/data/cz.json', () => {
  const cz = loadCz();

  it('declares countryCode CZ and a non-empty documentTypes list', () => {
    expect(cz.countryCode).toBe('CZ');
    expect(cz.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of cz.rules) {
      expect(() => assertValidProvenance(rule, 'cz.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/se.json/ie.json, no duplicates', () => {
    const pairs = cz.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in ZDPH § 34 odst. 1 (authenticity/integrity/legibility — Art. 233 VAT-directive transposition) composed with § 29 odst. 1 písm. e) (mandatory record number)', () => {
    const saveDraft = cz.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        '(1) U daňového dokladu musí být od okamžiku jeho vystavení do konce doby stanovené pro jeho ' +
          'uchovávání zajištěna a) věrohodnost jeho původu, b) neporušenost jeho obsahu a c) jeho čitelnost.',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/§ 29 odst\. 1 písm\. e\)/);
    expect(saveDraft.notes).toMatch(/evidenční číslo daňového dokladu/);
  });

  it('pins invoice.send: "legal", ZDPH § 26 odst. 3 — electronic tax document requires BOTH issuance-and-receipt electronically AND the recipient\'s consent', () => {
    const send = cz.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'Daňový doklad má elektronickou podobu tehdy, pokud je vystaven a obdržen elektronicky. S ' +
          'použitím daňového dokladu v elektronické podobě musí souhlasit osoba, pro kterou se plnění ' +
          'uskutečňuje.',
      );
      expect(send.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(send.notes).toMatch(/§ 28 odst\. 1 písm\. a\)/);
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation SE/MT/LV/NL/DE/IT/ES/PL/EE/IE already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = cz.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is "legal", grounded in the SAME single instrument as CORRECTIVE_INVOICE (ZDPH § 45 — the opravný daňový doklad), never a distinct Czech "avoir"', () => {
    const creditSend = cz.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'Opravný daňový doklad je daňový doklad, který se vystavuje při opravě základu nebo výše daně ' +
          '[...] Opravný daňový doklad lze vystavit i v případě, že je opravou zvyšována výše daně, ' +
          'pokud plátce přiznal daň jinak, než stanoví tento zákon, a tím snížil daň na výstupu.',
      );
    }
    expect(creditSend.notes).toMatch(/dobropis/);
    expect(creditSend.notes).toMatch(/vrubopis/);
    expect(creditSend.notes).toMatch(/NULLE PART/);
  });

  it('the file-level notes flag "dobropis"/"vrubopis" as accounting-practice usage, never a ZDPH statutory category, so a future reader never conflates them with the CREDIT_NOTE/DEBIT_NOTE correction routes', () => {
    expect(cz.notes).toMatch(/dobropis/);
    expect(cz.notes).toMatch(/vrubopis/);
    expect(cz.notes).toMatch(/§ 45/);
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = cz.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });

  it('invoice.record-payment stays "unverified" but cross-references the LEDGER_ANNOTATION finding pinned in correction-routes/data/cz.json (ZDPH § 42 odst. 4 písm. b) / § 43 odst. 2 písm. b))', () => {
    const recordPayment = cz.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'record-payment')!;
    expect(recordPayment.provenance.kind).toBe('unverified');
    if (recordPayment.provenance.kind === 'unverified') {
      expect(recordPayment.provenance.resolutionNote).toMatch(/§ 46/);
      expect(recordPayment.provenance.resolutionNote).toMatch(/LEDGER_ANNOTATION/);
    }
  });
});
