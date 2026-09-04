/**
 * FI — direct-load content spec, added by the FI country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as correction-routes/data/se.spec.ts: reads `fi.json` straight off disk rather than
 * through `data/all.ts` (wiring "fi" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidCorrectionRouteFact`) independently.
 *
 * FI has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, grounded in the PRIMARY legal text (finlex.fi's own full HTML of the
 * Arvonlisäverolaki (1501/1993), read with no fetch-summary tool involved), not merely an
 * administrative paraphrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadFi(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'fi.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('FI — correction-routes/data/fi.json', () => {
  const fi = loadFi();

  it('declares countryCode FI and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(fi.countryCode).toBe('FI');
    const ids = fi.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of fi.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'fi.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE, DEBIT_NOTE and CORRECTIVE_INVOICE are ALL "allowed" (never "required"), grounded in the SAME 209 e §18 content-mention clause — no Swedish-style mandatory-issuance clause was found', () => {
    const creditNote = fi.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    const debitNote = fi.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    const corrective = fi.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    for (const route of [creditNote, debitNote, corrective]) {
      expect(route.status).toBe('allowed');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toBe(
          'jos laskulla muutetaan aikaisemmin annettua laskua, yksiselitteinen viittaus tähän laskuun.',
        );
        expect(route.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('CREDIT_NOTE\'s note documents the real, checked absence of both a "hyvityslasku" term and a Swedish-style assimilation/mandatory-issuance clause', () => {
    const creditNote = fi.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.notes).toMatch(/hyvityslasku/);
    }
    expect(creditNote.notes).toMatch(/78 § kohta 1/);
  });

  it('the other eight routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'CORRECTIVE_INVOICE', 'DEBIT_NOTE']);
    const rest = fi.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("ANNOTATED_DUPLICATE's note documents a real, checked negative search against 209 e §18 without over-claiming a match to this route's exact definition", () => {
    const route = fi.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/209 e § kohta 18/);
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same 78 § kohta 3 "luottotappio" (bad debt) ambiguity, left genuinely undecided between the two', () => {
    const ledger = fi.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = fi.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/78 § kohta 3|luottotappio/);
      }
    }
  });

  it('CANCEL_AND_REPLACE notes the absence of any domestic clearance authority', () => {
    const route = fi.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(route.status).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/clearance/);
    }
  });

  it('every route id is unique', () => {
    const ids = fi.routes.map((r) => r.routeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** Tripwire de l'omission (standard depuis hu.spec.ts) : altérer UN MOT de la citation 209 e § kohta
   *  18 laisserait la suite verte si le spec n'épinglait que le statut/la référence. Le fragment
   *  distinctif — « laskulla muutetaan aikaisemmin annettua laskua » — est épinglé mot pour mot. */
  it('the 209 e §18 reference-to-original clause is pinned VERBATIM — one altered word trips this', () => {
    const corrective = fi.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE');
    expect(corrective?.provenance.kind === 'legal' ? corrective.provenance.sourceText : '').toContain(
      'laskulla muutetaan aikaisemmin annettua laskua',
    );
  });

  it('the file-level notes documents the Finlex full-text access method and the structural difference from the Swedish/Latvian assimilation-clause model', () => {
    expect(fi.notes ?? '').toMatch(/finlex\.fi/);
    expect(fi.notes ?? '').toMatch(/hyvityslasku/);
    expect(fi.notes ?? '').toMatch(/17 kap\. 22 §|17 kap\. 23 §/);
  });
});
