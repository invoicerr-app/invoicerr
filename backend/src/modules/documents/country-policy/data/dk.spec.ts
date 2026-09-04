/**
 * DK — direct-load content spec, added by the DK country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as country-policy/data/se.spec.ts: reads `dk.json` straight off disk rather than
 * through `data/all.ts` (wiring "dk" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadDk(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'dk.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('DK — country-policy/data/dk.json', () => {
  const dk = loadDk();

  it('declares countryCode DK and a non-empty documentTypes list', () => {
    expect(dk.countryCode).toBe('DK');
    expect(dk.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of dk.rules) {
      expect(() => assertValidProvenance(rule, 'dk.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/se.json, no duplicates', () => {
    const pairs = dk.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in a TWO-clause composition (momsbekendtgørelsen § 58 stk. 1 nr. 2 unique sequence number + § 68 stk. 1 authenticity/integrity)', () => {
    const saveDraft = dk.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        'Fortløbende nummer, der bygger på én eller flere serier, og som identificerer fakturaen.',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    // tripwire: the omission-detecting fragment for the SECOND, composed clause (§ 68 stk. 1) —
    // distinct from sourceText above, catches a summarizer that drops the composition entirely.
    expect(saveDraft.notes).toMatch(/oprindelsesægtheden, indholdsintegriteten og læsbarheden/);
    expect(saveDraft.notes).toMatch(/§ 68, stk\. 1/);
  });

  it('pins invoice.send: "legal", momsbekendtgørelsen § 68 stk. 4 — electronic invoicing subject to recipient consent', () => {
    const send = dk.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'En virksomhed kan kun udstede elektroniske fakturaer til en modtager, der accepterer dette.',
      );
    }
    // tripwire: the tacit-acceptance clause is a distinctive fragment a summary would easily drop.
    expect(send.notes).toMatch(/stiltiende/);
    // tripwire: the Bogføringsloven digital-bookkeeping nuance must not be conflated with an
    // e-invoicing mandate — the § 18 enabling-power caveat must survive.
    expect(send.notes).toMatch(/§ 18/);
    expect(send.notes).toMatch(/kan \[\.\.\.\] fastsætte/);
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation SE/LV/LU/NL/DE/IT/ES/PL/EE already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = dk.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is promoted to "legal" (MANDATORY, "skal udstedes") via momsloven § 52 a stk. 5, reinforced by § 27 stk. 4 and composed with momsbekendtgørelsen § 58 stk. 2', () => {
    const creditSend = dk.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'Hvis varer bliver returneret efter fakturaens udstedelse, skal der udstedes kreditnota. Det ' +
          'samme gælder, hvis leverandøren efter fakturaens udstedelse giver afslag i prisen.',
      );
    }
    // tripwire: the reinforcing § 27 stk. 4 fragment (conditional-discount deduction gated on the
    // credit note) — a distinctive fragment a paraphrase would drop.
    expect(creditSend.notes).toMatch(/er betinget af, at der udstedes kreditnota/);
    expect(creditSend.notes).toMatch(/§ 27, stk\. 4/);
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = dk.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });

  it('file-level notes flag the LBK renumbering (LBK nr 1021 af 26/09/2019 -> LBK nr 209 af 27/02/2024) and the single-VAT-rate singularity, and no rule cites the superseded 2019 act', () => {
    expect(dk.notes).toMatch(/2024\/209/);
    expect(dk.notes).toMatch(/LBK nr 1021 af 26\/09\/2019/);
    expect(dk.notes).toMatch(/Afgiftssatsen/);
    for (const rule of dk.rules) {
      if (rule.provenance.kind === 'legal') {
        expect(rule.provenance.sourceText).not.toMatch(/1021/);
      }
      expect(rule.notes ?? '').not.toMatch(/LBK nr 1021/);
    }
  });
});
