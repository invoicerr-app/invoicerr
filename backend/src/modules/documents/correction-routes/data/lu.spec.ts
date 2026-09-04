/**
 * LU — direct-load content spec, added by the LU country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as correction-routes/data/ee.spec.ts: reads `lu.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX/NL/AT/BE/EE/GR — wiring "lu" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * LU has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, grounded in the PRIMARY legal text (legilux.public.lu, reached via SPARQL
 * content-negotiation — see vat-rates/data/lu.json's own file-level note for the access method), not
 * merely an administrative paraphrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadLu(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'lu.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('LU — correction-routes/data/lu.json', () => {
  const lu = loadLu();

  it('declares countryCode LU and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(lu.countryCode).toBe('LU');
    const ids = lu.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of lu.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'lu.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE, DEBIT_NOTE and CORRECTIVE_INVOICE are all "allowed", grounded in the SAME LTVA art. 63 §2 assimilation clause — a general clause, not a named instrument', () => {
    const creditNote = lu.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    const debitNote = lu.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    const corrective = lu.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    for (const route of [creditNote, debitNote, corrective]) {
      expect(route.status).toBe('allowed');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toMatch(
          /assimilé à une facture tout document ou message qui modifie la facture initiale/,
        );
        expect(route.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('the other eight routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE']);
    const rest = lu.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("ANNOTATED_DUPLICATE's note documents the real art. 63 §11 finding (a separate simplified document, not the same original invoice re-issued) without over-claiming a match to this route's exact definition", () => {
    const route = lu.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/§ 11/);
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same unresolved research gap (the base-adjustment clause for cancellation/irrecoverable debt was not located)', () => {
    const ledger = lu.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = lu.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
    }
    if (ledger.provenance.kind === 'unverified') {
      expect(ledger.provenance.resolutionNote).toMatch(/base d'imposition/);
    }
  });

  it('the file-level notes documents the absence of a CORRECTION-ROUTES.yaml pivot for LU and the legilux SPARQL access method', () => {
    expect(lu.notes ?? '').toMatch(/meta\.covered/);
    expect(lu.notes ?? '').toMatch(/sparqlendpoint/);
  });
});
