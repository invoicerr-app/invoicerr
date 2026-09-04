/**
 * HU — direct-load content spec, added by the HU-COMPLEMENT country agent (TODO_DOCUMENTS.md, vague
 * B, lot 4). Same rationale as country-policy/data/gr.spec.ts: reads `hu.json` straight off disk
 * rather than through `data/all.ts` (still FR/DE/IT/PL/ES/US/MX only — wiring "hu" in is a
 * mandataire decision), and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`)
 * independently.
 *
 * HU has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country (same situation as GR/CY/LT/LV in earlier lots).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadHu(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'hu.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('HU — correction-routes/data/hu.json', () => {
  const hu = loadHu();

  it('declares countryCode HU and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(hu.countryCode).toBe('HU');
    const ids = hu.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of hu.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'hu.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "allowed", naming the "érvénytelenítő számla" instrument (Áfa tv. 153/B. § (1) a))', () => {
    const creditNote = hu.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('allowed');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toMatch(/érvénytelenítő számla/);
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE is "allowed", grounded in the "számlával egy tekintet alá eső okirat" assimilation clause (Áfa tv. 168. § (2))', () => {
    const corrective = hu.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(corrective.status).toBe('allowed');
    expect(corrective.provenance.kind).toBe('legal');
    if (corrective.provenance.kind === 'legal') {
      expect(corrective.provenance.sourceText).toMatch(/számlával egy tekintet alá esik/);
      expect(corrective.provenance.sourceText).toMatch(/170\. §/);
    }
    expect(corrective.notes).toMatch(/170 \(1\)/);
  });

  it('CANCEL_AND_REPLACE is "allowed", sourced to the NAV Online Számla 3.0 interface specification', () => {
    const cancelAndReplace = hu.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(cancelAndReplace.status).toBe('allowed');
    expect(cancelAndReplace.provenance.kind).toBe('legal');
    if (cancelAndReplace.provenance.kind === 'legal') {
      expect(cancelAndReplace.provenance.sourceText).toMatch(/invoice annulment and the issuance of a new/);
    }
    expect(cancelAndReplace.notes).toMatch(/nav-gov-hu\/Online-Invoice/);
  });

  it('exactly three routes are "legal"/non-unverified — the other eight are honestly "unverified"', () => {
    const legal = hu.routes.filter((r) => r.provenance.kind === 'legal');
    const unverified = hu.routes.filter((r) => r.provenance.kind === 'unverified');
    expect(legal.length).toBe(3);
    expect(unverified.length).toBe(8);
    for (const route of unverified) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it('DEBIT_NOTE stays "unverified" — no distinct named increasing-invoice instrument was found', () => {
    const debitNote = hu.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(debitNote.status).toBe('unverified');
    if (debitNote.provenance.kind === 'unverified') {
      expect(debitNote.provenance.resolutionNote).toMatch(/terhelő számla/);
    }
  });

  it('AUTHORITY_ANNULMENT and RESUBMIT_SAME_IDENTITY stay "unverified" despite a strong lead (NAV technical annulment), because the spec itself distinguishes it from annulling the invoice', () => {
    for (const routeId of ['AUTHORITY_ANNULMENT', 'RESUBMIT_SAME_IDENTITY']) {
      const route = hu.routes.find((r) => r.routeId === routeId)!;
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/technical annulment/);
      }
    }
    const authorityAnnulment = hu.routes.find((r) => r.routeId === 'AUTHORITY_ANNULMENT')!;
    if (authorityAnnulment.provenance.kind === 'unverified') {
      expect(authorityAnnulment.provenance.resolutionNote).toMatch(/manageAnnulment/);
      expect(authorityAnnulment.provenance.resolutionNote).toMatch(/NOT identical/);
    }
    const resubmit = hu.routes.find((r) => r.routeId === 'RESUBMIT_SAME_IDENTITY')!;
    if (resubmit.provenance.kind === 'unverified') {
      expect(resubmit.provenance.resolutionNote).toMatch(/correctly describes the economic event/);
    }
  });

  it('INTERNAL_CREDIT_NOTE stays "unverified", not promoted to "forbidden", despite the documented tension with mandatory real-time reporting', () => {
    const internalCreditNote = hu.routes.find((r) => r.routeId === 'INTERNAL_CREDIT_NOTE')!;
    expect(internalCreditNote.status).toBe('unverified');
    if (internalCreditNote.provenance.kind === 'unverified') {
      expect(internalCreditNote.provenance.resolutionNote).toMatch(/számlával egy tekintet alá eső okirat/);
    }
  });

  it('every route id is unique', () => {
    const ids = hu.routes.map((r) => r.routeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the file-level notes documents the net.jogtar.hu access-method workaround for the njt.hu connection resets', () => {
    expect(hu.notes ?? '').toMatch(/net\.jogtar\.hu/);
    expect(hu.notes ?? '').toMatch(/njt\.hu/);
  });

  /** Tripwire de la VALIDATION lot 4 (2026-09-04) : altérer UN MOT de la citation §170 laissait la
   *  suite verte — le spec épinglait statut et référence, jamais le verbatim. Or la classe de risque
   *  « mots fabriqués/omis » (mémoire feedback-legal-raw-text) vit précisément là : le fragment
   *  distinctif de la clause d'assimilation hongroise est épinglé mot pour mot. */
  it("the §170 assimilation clause is pinned VERBATIM — « A számlával egy tekintet alá esik... okirat » (168. § (2)), one altered word trips this", () => {
    const route = hu.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE');
    expect(route?.provenance.kind).toBe('legal');
    expect(route?.provenance.kind === 'legal' ? route.provenance.sourceText : '').toContain(
      'A számlával egy tekintet alá esik minden más, az (1) bekezdéstől eltérő okirat',
    );
  });
});
