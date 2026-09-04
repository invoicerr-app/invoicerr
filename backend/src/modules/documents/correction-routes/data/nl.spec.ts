/**
 * NL — direct-load content spec, added by the NL country agent (TODO_DOCUMENTS.md, vague B, lot 1).
 * Same rationale as country-policy/data/nl.spec.ts: reads `nl.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX only — wiring "nl" in is a mandataire decision),
 * and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * NL has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadNl(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'nl.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('NL — correction-routes/data/nl.json', () => {
  const nl = loadNl();

  it('declares countryCode NL and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(nl.countryCode).toBe('NL');
    const ids = nl.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of nl.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'nl.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is the sourced classic route — "allowed", grounded in Wet OB 1968 art. 29 and the Belastingdienst "creditfactuur" doctrine, never "creditnota"', () => {
    const creditNote = nl.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('allowed');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(/creditfactuur/);
      expect(creditNote.provenance.sourceText).not.toMatch(/creditnota/i);
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('the other ten routes are honestly "unverified" — Dutch VAT law carries no general document-modification-assimilation clause like FR (CGI 289 I.5) or PL (art. 106j)', () => {
    const rest = nl.routes.filter((r) => r.routeId !== 'CREDIT_NOTE');
    expect(rest.length).toBe(10);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("ANNOTATED_DUPLICATE's note documents the real FR/NL divergence found — no annotated-duplicate obligation exists for Dutch non-payment relief", () => {
    const route = nl.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/art\. 272/);
    }
  });
});
