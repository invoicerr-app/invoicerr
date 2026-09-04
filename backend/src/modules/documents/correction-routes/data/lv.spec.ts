/**
 * LV — direct-load content spec, added by the LV country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as correction-routes/data/ee.spec.ts: reads `lv.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX/NL/AT/EE/GR/CY — wiring "lv" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * LV has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription, but grounded in the PRIMARY legal text (likumi.lv's own
 * consolidated English translation of the Value Added Tax Law, read as plain HTML with no fetch-
 * summary tool involved), not merely an administrative paraphrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadLv(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'lv.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('LV — correction-routes/data/lv.json', () => {
  const lv = loadLv();

  it('declares countryCode LV and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(lv.countryCode).toBe('LV');
    const ids = lv.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of lv.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'lv.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "allowed", grounded in Value Added Tax Law art. 39(2) — the primary statutory text, not an administrative paraphrase', () => {
    const creditNote = lv.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('allowed');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(/a tax invoice that amends the initial invoice/);
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE and DEBIT_NOTE are BOTH "allowed", grounded in the SAME art. 125(5) general document-deemed-equivalent clause — a real finding absent from nl.json/at.json', () => {
    const corrective = lv.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    const debit = lv.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    for (const route of [corrective, debit]) {
      expect(route.status).toBe('allowed');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toBe(
          'Any document which amends the initial tax invoice or especially and clearly indicates thereto shall be regarded as equivalent to the tax invoice if it conforms to the requirements laid down in Paragraph one of this Section.',
        );
      }
    }
  });

  it('the other eight routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'CORRECTIVE_INVOICE', 'DEBIT_NOTE']);
    const rest = lv.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("ANNOTATED_DUPLICATE's note documents the TWO real adjacent findings (art. 105(3) bad-debt notification, art. 126(2)(2) additional simplified tax invoice) without over-claiming a match to this route's exact definition", () => {
    const route = lv.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/art\. 105 al\. 3/);
      expect(route.provenance.resolutionNote).toMatch(/art\. 126 al\. 2 cl\. 2/);
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same art. 129(6) "cancelled tax invoice kept in the accounting" ambiguity, left genuinely undecided between the two', () => {
    const ledger = lv.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = lv.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/art\. 129 al\. 6|LEDGER_ANNOTATION/);
      }
    }
  });

  it('CANCEL_AND_REPLACE documents the same art. 129(6) finding, noting the absence of any domestic clearance authority', () => {
    const route = lv.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(route.status).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/art\. 129 al\. 6/);
      expect(route.provenance.resolutionNote).toMatch(/b2g-routing/);
    }
  });
});
