/**
 * LT — direct-load content spec, added by the LT country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as correction-routes/data/ee.spec.ts: reads `lt.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX/NL/AT/EE/GR — wiring "lt" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * LT has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription, but grounded in the PRIMARY legal text (e-tar.lt's own
 * static rendering of the consolidated PVMĮ, reached via a real browser — see country-policy/data/
 * lt.json's own file-level note for the access method and why e-seimas.lrs.lt's own title-search
 * field turned out unreliable for automated input), not merely an administrative paraphrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadLt(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'lt.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('LT — correction-routes/data/lt.json', () => {
  const lt = loadLt();

  it('declares countryCode LT and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(lt.countryCode).toBe('LT');
    const ids = lt.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of lt.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'lt.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "required", grounded in PVMĮ art. 83(1) first sentence — the seller MUST issue a kreditinis dokumentas', () => {
    const creditNote = lt.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('required');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(/privalo išrašyti asmuo/);
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('DEBIT_NOTE is "allowed", grounded in the SAME art. 83(1) — the buyer MAY issue a debetinis dokumentas instead, if the buyer is itself a VAT payer', () => {
    const debit = lt.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(debit.status).toBe('allowed');
    expect(debit.provenance.kind).toBe('legal');
    if (debit.provenance.kind === 'legal') {
      expect(debit.provenance.sourceText).toMatch(/debetiniu dokumentu/);
      expect(debit.provenance.sourceText).toMatch(/PVM mokėtojas/);
    }
  });

  it('CORRECTIVE_INVOICE stays "unverified" — PVMĮ art. 83 has no general document-deemed-an-invoice clause, unlike ee.json/gr.json', () => {
    const corrective = lt.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(corrective.status).toBe('unverified');
    expect(corrective.provenance.kind).toBe('unverified');
    if (corrective.provenance.kind === 'unverified') {
      expect(corrective.provenance.resolutionNote).toMatch(/AUCUNE clause GÉNÉRALE/);
    }
  });

  it('the other nine routes (all but CREDIT_NOTE and DEBIT_NOTE) are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'DEBIT_NOTE']);
    const rest = lt.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(9);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });
});
