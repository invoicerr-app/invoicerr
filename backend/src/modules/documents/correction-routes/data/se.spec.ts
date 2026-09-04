/**
 * SE — direct-load content spec, added by the SE country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as correction-routes/data/lv.spec.ts: reads `se.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX/NL/AT/EE/GR/CY/LV/LU — wiring "se" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`)
 * independently.
 *
 * SE has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription, but grounded in the PRIMARY legal text (riksdagen.se's own
 * full HTML of the Mervärdesskattelag (2023:200), read with no fetch-summary tool involved), not
 * merely an administrative paraphrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadSe(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'se.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('SE — correction-routes/data/se.json', () => {
  const se = loadSe();

  it('declares countryCode SE and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(se.countryCode).toBe('SE');
    const ids = se.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of se.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'se.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "required" (stronger than lv.json/lu.json\'s own "allowed") — Mervärdesskattelag 17 kap. 23 § mandates issuance for price reductions/customer crediting', () => {
    const creditNote = se.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('required');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(/ska utfärdas vid/);
      expect(creditNote.provenance.sourceText).toMatch(/kundkreditering/);
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE and DEBIT_NOTE are BOTH "allowed", grounded in the SAME 17 kap. 22 § general document-deemed-equivalent clause', () => {
    const corrective = se.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    const debit = se.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    for (const route of [corrective, debit]) {
      expect(route.status).toBe('allowed');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toBe(
          'Varje handling eller meddelande med ändring av den ursprungliga fakturan och med en särskild och otvetydig hänvisning till den ursprungliga fakturan likställs med en faktura.',
        );
      }
    }
  });

  it('the other eight routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'CORRECTIVE_INVOICE', 'DEBIT_NOTE']);
    const rest = se.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("ANNOTATED_DUPLICATE's note documents the real adjacent finding (17 kap. 28 §5 simplified-invoice reference) without over-claiming a match to this route's exact definition", () => {
    const route = se.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/17 kap\. 28 § punkt 5|28 § point 5/);
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same 8 kap. 16 § "kundförlust" (bad debt) ambiguity, left genuinely undecided between the two', () => {
    const ledger = se.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = se.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/8 kap\. 16 §|LEDGER_ANNOTATION/);
      }
    }
  });

  it('CANCEL_AND_REPLACE notes the absence of any domestic clearance authority', () => {
    const route = se.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(route.status).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/b2g-routing/);
    }
  });
});
