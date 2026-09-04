/**
 * IE — direct-load content spec, added by the IE country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as correction-routes/data/se.spec.ts: reads `ie.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX/NL/AT/EE/GR/CY/LV/LU/MT/SE — wiring "ie" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`)
 * independently.
 *
 * IE has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription, but grounded in the PRIMARY legal text (revisedacts.
 * lawreform.ie's own full HTML of the Value-Added Tax Consolidation Act 2010, and irishstatutebook.
 * ie's own full text of the Value-Added Tax Regulations 2010, S.I. No. 639 of 2010 — no fetch-summary
 * tool involved for either).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadIe(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'ie.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('IE — correction-routes/data/ie.json', () => {
  const ie = loadIe();

  it('declares countryCode IE and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(ie.countryCode).toBe('IE');
    const ids = ie.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of ie.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'ie.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "required" — VATCA s. 67(1)(b)(i) names AND defines the "credit note" inside its own mandatory-issuance clause', () => {
    const creditNote = ie.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('required');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(/in this Act referred to as a "credit note"/);
      expect(creditNote.provenance.sourceText).toMatch(/the person shall issue/);
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE is ALSO "required" — VATCA s. 67(1)(a), the exact symmetric counterpart of CREDIT_NOTE for a price INCREASE, via "another invoice" (never called a "debit note")', () => {
    const corrective = ie.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(corrective.status).toBe('required');
    expect(corrective.provenance.kind).toBe('legal');
    if (corrective.provenance.kind === 'legal') {
      expect(corrective.provenance.sourceText).toMatch(/the consideration is increased/);
      expect(corrective.provenance.sourceText).toMatch(/another invoice/);
    }
    expect(corrective.notes).toMatch(/67\(1\)\(a\)/);
  });

  it('DEBIT_NOTE stays "unverified" — and the resolutionNote documents WHY: Ireland\'s own statutory "debit note" (s. 67(2)) is a false friend that formalizes a DECREASE, not an increase', () => {
    const debitNote = ie.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(debitNote.status).toBe('unverified');
    expect(debitNote.provenance.kind).toBe('unverified');
    if (debitNote.provenance.kind === 'unverified') {
      expect(debitNote.provenance.resolutionNote).toMatch(/FAUX-AMI/);
      expect(debitNote.provenance.resolutionNote).toMatch(/67\(2\)/);
      expect(debitNote.provenance.resolutionNote).toMatch(/DEEMED/);
    }
  });

  it('CANCEL_AND_REPLACE is "required" but narrowly scoped to VATCA s. 67(3) — the wrong-tax-rate case only, never a general cancellation right', () => {
    const cancelAndReplace = ie.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(cancelAndReplace.status).toBe('required');
    expect(cancelAndReplace.provenance.kind).toBe('legal');
    if (cancelAndReplace.provenance.kind === 'legal') {
      expect(cancelAndReplace.provenance.sourceText).toMatch(/deemed to have been reduced to nil/);
      expect(cancelAndReplace.provenance.sourceText).toMatch(/a lower rate of tax applied/);
    }
    expect(cancelAndReplace.notes).toMatch(/MISE EN GARDE SUR LA PORTÉE/);
  });

  it('LEDGER_ANNOTATION is "allowed" and "legal" — Reg. 10(3)(c) composed with Reg. 27(1)(m)\'s four named particulars for a written-off bad debt (a sharper finding than se.json/mt.json\'s own inconclusive LEDGER_ANNOTATION)', () => {
    const ledger = ie.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    expect(ledger.status).toBe('allowed');
    expect(ledger.provenance.kind).toBe('legal');
    if (ledger.provenance.kind === 'legal') {
      expect(ledger.provenance.sourceText).toMatch(/Regulation 27\(1\)\(m\)/);
      expect(ledger.provenance.sourceText).toMatch(/written off in the financial accounts/);
    }
    expect(ledger.notes).toMatch(/QUATRE particulars/);
  });

  it('NO_DOCUMENT_BY_LAW stays "unverified" — partly ruled out by the LEDGER_ANNOTATION finding for the bad-debt case specifically, but not excluded catalogue-wide', () => {
    const noDoc = ie.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    expect(noDoc.status).toBe('unverified');
    if (noDoc.provenance.kind === 'unverified') {
      expect(noDoc.provenance.resolutionNote).toMatch(/LEDGER_ANNOTATION/);
    }
  });

  it('the remaining routes (INTERNAL_CREDIT_NOTE, AUTHORITY_ANNULMENT, RESUBMIT_SAME_IDENTITY, ANNOTATED_DUPLICATE, COUNTERPARTY_OBJECTION) are honestly "unverified"', () => {
    const settled = new Set(['CREDIT_NOTE', 'CORRECTIVE_INVOICE', 'CANCEL_AND_REPLACE', 'LEDGER_ANNOTATION']);
    const rest = ie.routes.filter((r) => !settled.has(r.routeId));
    expect(rest.length).toBe(7);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it('the file-level notes flag the "debit note" false-friend finding as the headline methodological result of this file', () => {
    expect(ie.notes).toMatch(/FAUX-AMI TERMINOLOGIQUE/);
    expect(ie.notes).toMatch(/b2g-routing\/data\/ie\.json/);
  });
});
