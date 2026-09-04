/**
 * EE — direct-load content spec, added by the EE country agent (TODO_DOCUMENTS.md, vague B, lot 2).
 * Same rationale as correction-routes/data/nl.spec.ts: reads `ee.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX/NL/AT — wiring "ee" in is a mandataire decision),
 * and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * EE has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription, but grounded in the PRIMARY legal text (riigiteataja.ee's
 * own API, reached directly by curl — see vat-rates/data/ee.json's own file-level note for the
 * access method), not merely an administrative paraphrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadEe(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'ee.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('EE — correction-routes/data/ee.json', () => {
  const ee = loadEe();

  it('declares countryCode EE and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(ee.countryCode).toBe('EE');
    const ids = ee.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of ee.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'ee.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "allowed", grounded in Käibemaksuseadus § 29(7) — the primary statutory text, not an administrative paraphrase', () => {
    const creditNote = ee.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('allowed');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(
        /A credit invoice may only be submitted with regard to a specific invoice/,
      );
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE and DEBIT_NOTE are BOTH "allowed", grounded in the SAME § 37(4) general document-deemed-an-invoice clause — a real finding absent from nl.json/at.json', () => {
    const corrective = ee.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    const debit = ee.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    for (const route of [corrective, debit]) {
      expect(route.status).toBe('allowed');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toBe(
          'A document, including a credit invoice, which amends an initial invoice and which contains a reference to the initial invoice shall be deemed to be an invoice.',
        );
      }
    }
  });

  it('the other eight routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'CORRECTIVE_INVOICE', 'DEBIT_NOTE']);
    const rest = ee.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("ANNOTATED_DUPLICATE's note documents the real § 29¹ finding (a written notification, not a re-issued annotated invoice) without over-claiming a match to this route's exact definition", () => {
    const route = ee.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/§ 29¹/);
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same § 29(7) "cancels an invoice" ambiguity, left genuinely undecided between the two', () => {
    const ledger = ee.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = ee.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/cancels an invoice|LEDGER_ANNOTATION/);
      }
    }
  });
});
