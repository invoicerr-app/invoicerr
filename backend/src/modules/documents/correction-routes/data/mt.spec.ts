/**
 * MT — direct-load content spec, added by the MT country agent (TODO_DOCUMENTS.md, vague B, lot 4).
 * Same rationale as correction-routes/data/lv.spec.ts: reads `mt.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX/NL/AT/EE/GR/CY/LV/LU — wiring "mt" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`)
 * independently.
 *
 * MT has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription, but grounded in the PRIMARY legal text (the Value Added Tax
 * Act, Chapter 406 — English is one of Malta's two official languages, so this is not a translation
 * question the way it was for LV/EE/CY), fetched as a raw PDF from legislation.mt's own `/getpdf/<id>`
 * endpoint (never a fetch-summary tool — see mt.json's own file-level note for how that endpoint was
 * found behind the site's Angular SPA shell).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadMt(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'mt.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('MT — correction-routes/data/mt.json', () => {
  const mt = loadMt();

  it('declares countryCode MT and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(mt.countryCode).toBe('MT');
    const ids = mt.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of mt.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'mt.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE and DEBIT_NOTE are BOTH "allowed", grounded in the SAME Eleventh Schedule item 1(1)(h) clause that NAMES both instruments explicitly — a stronger finding than lv.json/ee.json, which had no dedicated term', () => {
    const creditNote = mt.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    const debitNote = mt.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    for (const route of [creditNote, debitNote]) {
      expect(route.status).toBe('allowed');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toBe(
          'all credit notes, debit notes and other documents issued by him or received by him which ' +
            'evidence an increase or a decrease in the consideration for any supplies, intra-community ' +
            'acquisitions or importations',
        );
        expect(route.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('CORRECTIVE_INVOICE is "allowed", grounded in the Twelfth Schedule item 1(2) general document-deemed-equivalent clause', () => {
    const corrective = mt.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(corrective.status).toBe('allowed');
    expect(corrective.provenance.kind).toBe('legal');
    if (corrective.provenance.kind === 'legal') {
      expect(corrective.provenance.sourceText).toBe(
        'Any document or message that amends and refers specifically and unambiguously to the ' +
          'initial invoice shall be treated as an invoice.',
      );
    }
    expect(corrective.notes).toMatch(/item 5\(g\)/);
  });

  it('the other eight routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE']);
    const rest = mt.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same Tenth Schedule item 11 finding — a document-free adjustment mechanism, left genuinely undecided between the two', () => {
    const ledger = mt.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = mt.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/item 11|LEDGER_ANNOTATION/);
      }
    }
  });

  it('CANCEL_AND_REPLACE honestly reports finding NO Maltese equivalent to LV\'s "cancelled tax invoice" clause — "cancel"/"cancellation" only ever refers to registration', () => {
    const route = mt.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(route.status).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/REGISTRATION/);
      expect(route.provenance.resolutionNote).toMatch(/b2g-routing/);
    }
  });

  it("ANNOTATED_DUPLICATE documents the Tenth Schedule item 10 bad-debt-relief finding without over-claiming a match to this route's exact definition", () => {
    const route = mt.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/[Bb]ad debt relief/);
    }
  });
});
