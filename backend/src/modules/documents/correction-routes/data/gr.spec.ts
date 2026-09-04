/**
 * GR — direct-load content spec, added by the GR country agent (TODO_DOCUMENTS.md, vague B, lot 2).
 * Same rationale as country-policy/data/gr.spec.ts: reads `gr.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX only — wiring "gr" in is a mandataire decision),
 * and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * GR has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription (same situation as country-policy/data/nl.json in lot 1).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadGr(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'gr.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('GR — correction-routes/data/gr.json', () => {
  const gr = loadGr();

  it('declares countryCode GR and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(gr.countryCode).toBe('GR');
    const ids = gr.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of gr.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'gr.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "allowed" and legally grounded in the named "πιστωτικό τιμολόγιο" instrument (Ν.4308/2014 άρθρο 8 § 6)', () => {
    const creditNote = gr.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('allowed');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(/Πιστωτικό τιμολόγιο/);
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE is "allowed" and legally grounded in the general document-modification-assimilation clause (Ν.4308/2014 άρθρο 8 § 3)', () => {
    const corrective = gr.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(corrective.status).toBe('allowed');
    expect(corrective.provenance.kind).toBe('legal');
    if (corrective.provenance.kind === 'legal') {
      expect(corrective.provenance.sourceText).toMatch(/θεωρείται τιμολόγιο/);
    }
  });

  it('exactly two routes are "legal"/non-unverified — the other nine are honestly "unverified"', () => {
    const legal = gr.routes.filter((r) => r.provenance.kind === 'legal');
    const unverified = gr.routes.filter((r) => r.provenance.kind === 'unverified');
    expect(legal.length).toBe(2);
    expect(unverified.length).toBe(9);
    for (const route of unverified) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it('DEBIT_NOTE stays "unverified" — no "χρεωστικό τιμολόγιο" term was found in the articles read', () => {
    const debitNote = gr.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(debitNote.status).toBe('unverified');
    if (debitNote.provenance.kind === 'unverified') {
      expect(debitNote.provenance.resolutionNote).toMatch(/χρεωστικό τιμολόγιο/);
    }
  });

  it('several unverified routes explicitly document their dependency on the same aade.gr wall reporting/data/gr.json already carries', () => {
    const dependent = ['INTERNAL_CREDIT_NOTE', 'AUTHORITY_ANNULMENT', 'COUNTERPARTY_OBJECTION'];
    for (const routeId of dependent) {
      const route = gr.routes.find((r) => r.routeId === routeId)!;
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/aade\.gr/);
      }
    }
  });
});
