/**
 * SK — direct-load content spec, added by the SK country agent (TODO_DOCUMENTS.md, vague B, lot 7 —
 * dernier lot). Same rationale as country-policy/data/cz.spec.ts: reads `sk.json` straight off disk
 * rather than through `data/all.ts` (wiring "sk" in is a mandataire decision), and re-runs the exact
 * load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadSk(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'sk.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('SK — country-policy/data/sk.json', () => {
  const sk = loadSk();

  it('declares countryCode SK and a non-empty documentTypes list', () => {
    expect(sk.countryCode).toBe('SK');
    expect(sk.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of sk.rules) {
      expect(() => assertValidProvenance(rule, 'sk.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/se.json/ie.json/cz.json, no duplicates', () => {
    const pairs = sk.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in § 71 ods. 3 (authenticity/integrity/legibility — Art. 233 VAT-directive transposition), composed in the notes with § 74 ods. 1 písm. c) (mandatory SEQUENTIAL number — "poradové", unlike the Czech text)', () => {
    const saveDraft = sk.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        'Zdaniteľná osoba je povinná zabezpečiť vierohodnosť pôvodu, neporušenosť obsahu a čitateľnosť ' +
          'faktúry od jej vydania do konca obdobia na uchovávanie faktúry.',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(saveDraft.notes).toMatch(/§ 74 ods\. 1 písm\. c\)/);
    expect(saveDraft.notes).toMatch(/poradové/);
  });

  it('pins invoice.send: "legal", § 71 ods. 1 písm. b) — an electronic faktúra requires ONLY the recipient\'s consent (a single condition, unlike the Czech dual issuance-and-receipt-plus-consent rule)', () => {
    const send = sk.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'Elektronickou faktúrou je faktúra, ktorá obsahuje údaje podľa § 74 a je vydaná a prijatá v ' +
          'akomkoľvek elektronickom formáte; elektronickú faktúru možno vydať len so súhlasom príjemcu ' +
          'tovaru alebo služby.',
      );
      expect(send.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(send.notes).toMatch(/§ 72 ods\. 1 písm\. a\)/);
    expect(send.notes).toMatch(/§ 85o ods\. 22/);
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation SE/MT/LV/NL/DE/IT/ES/PL/EE/IE/CZ already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = sk.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is "legal", grounded in the SAME single instrument as CORRECTIVE_INVOICE (§ 71 ods. 2 — the faktúra that amends the original), never a distinct Slovak "avoir"', () => {
    const creditSend = sk.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'Za faktúru sa považuje aj každý doklad alebo oznámenie, ktoré mení pôvodnú faktúru a osobitne a ' +
          'jednoznačne sa na ňu vzťahuje.',
      );
    }
    expect(creditSend.notes).toMatch(/dobropis/);
    expect(creditSend.notes).toMatch(/ťarchopis/);
    expect(creditSend.notes).toMatch(/ZÉRO occurrence/);
  });

  it('the file-level notes flag "dobropis"/"ťarchopis"/"vrubopis" as accounting-practice usage, never a zákon o DPH statutory category, so a future reader never conflates them with the CREDIT_NOTE/DEBIT_NOTE correction routes', () => {
    expect(sk.notes).toMatch(/dobropis/);
    expect(sk.notes).toMatch(/ťarchopis/);
    expect(sk.notes).toMatch(/vrubopis/);
    expect(sk.notes).toMatch(/§ 25 ods\. 1/);
  });

  it('the file-level notes trace the IS EFA mandate to a real, promulgated law (385/2025 Z. z.) and pin the actual mandatory-reporting date to 1 July 2030 — not 2027', () => {
    expect(sk.notes).toMatch(/385\/2025/);
    expect(sk.notes).toMatch(/1er JUILLET 2030/);
    expect(sk.notes).toMatch(/PAS 2027/);
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = sk.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });

  it('invoice.record-payment stays "unverified" but cross-references § 25a (the bad-debt "opravný doklad", explicitly NOT a faktúra) and correction-routes/data/sk.json\'s own NO_DOCUMENT_BY_LAW finding', () => {
    const recordPayment = sk.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'record-payment')!;
    expect(recordPayment.provenance.kind).toBe('unverified');
    if (recordPayment.provenance.kind === 'unverified') {
      expect(recordPayment.provenance.resolutionNote).toMatch(/§ 25a/);
      expect(recordPayment.provenance.resolutionNote).toMatch(/NO_DOCUMENT_BY_LAW/);
    }
  });
});
