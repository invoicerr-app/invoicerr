/**
 * NL — direct-load content spec, added by the NL country agent (TODO_DOCUMENTS.md, vague B, lot 1).
 *
 * Deliberately does NOT go through `data/all.ts` (which still only lists FR/US/HU/DE/IT/PL/ES/MX —
 * wiring "nl" into that aggregator, and into `data/all.spec.ts`'s own coverage-guard assertions, is a
 * mandataire decision made once every lot-1 country agent (BE/AT/NL) has landed its own files). This
 * spec instead reads `nl.json` straight off disk with the same `readFileSync` + `JSON.parse` shape
 * `data/all.ts` itself uses, and re-runs the exact load-time gate (`assertValidProvenance`) so a
 * malformed or unsourced NL rule fails here today, independently of when the file gets wired in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadNl(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'nl.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('NL — country-policy/data/nl.json', () => {
  const nl = loadNl();

  it('declares countryCode NL and a non-empty documentTypes list', () => {
    expect(nl.countryCode).toBe('NL');
    expect(nl.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of nl.rules) {
      expect(() => assertValidProvenance(rule, 'nl.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as fr.json/pl.json, no duplicates', () => {
    const pairs = nl.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in the art. 35a numbering-uniqueness composition (not a direct FR/PL-style intangibility clause)', () => {
    const saveDraft = nl.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toMatch(/eenduidig wordt geïdentificeerd/);
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/COMPOSITION/);
  });

  it('pins invoice.send: "legal", Wet OB 1968 art. 35b lid 1 — electronic invoicing subject to buyer acceptance', () => {
    const send = nl.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'Elektronische facturering wordt toegepast behoudens aanvaarding door de afnemer.',
      );
    }
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation DE/IT/ES/PL already carry — a directly-applicable EU regulation', () => {
    const quoteSend = nl.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send stays "unverified" (the status transition is a product mechanism, not the legal regime) but documents the "creditfactuur" finding', () => {
    const creditSend = nl.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('unverified');
    if (creditSend.provenance.kind === 'unverified') {
      expect(creditSend.provenance.resolutionNote).toMatch(/creditfactuur/);
    }
  });
});
