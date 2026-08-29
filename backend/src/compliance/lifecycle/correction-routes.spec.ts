/**
 * P3-T02 — the routes, asserted against the profiles that now carry them.
 *
 * These tests exist to make the P3-T01 findings load-bearing. Each one fails if someone collapses
 * the model back to a single value per country, which is exactly what the repository did for every
 * jurisdiction before this task.
 */
import {
  isAvailable,
  primaryCorrectionModel,
  routesForDirection,
  statusOf,
  untransmittableRoutes,
} from './correction-routes';
import { resolve } from '../engine/compliance-engine';
import { defaultRegistry } from '../profiles/registry';
import { CorrectionRoute } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';

const PIVOTS = ['FR', 'IT', 'PL', 'DE', 'ES', 'MX', 'US'] as const;

function party(country: string): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role: 'B2B',
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

/** Domestic B2B on the given date — the plainest transaction each country has an answer for. */
function tx(country: string, issueDate: string): TransactionContext {
  return {
    supplier: party(country),
    buyer: party(country),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
    issueDate: new Date(issueDate),
    currency: 'EUR',
  };
}

/** The routes as they stand on a given date, straight off the resolved plan. */
function routesOn(country: string, date: string) {
  return resolve(tx(country, date)).lifecycle.correctionRoutes;
}

describe('P3-T02 — correction routes', () => {
  describe('the finding that made this task necessary', () => {
    it('INTERNAL_CREDIT_NOTE is REQUIRED in FR and IT and FORBIDDEN in PL, ES and MX', () => {
      // The decisive result of P3-T01, and it is not a nuance: the same route is compelled in two
      // countries and prohibited in three. France on statuses Refusée/Rejetée (spécifications
      // externes DGFiP v3.2 §3.6.4), Italy after a scarto (Provv. 89757/2018 punto 6.3) — against
      // Poland (Podręcznik KSeF 2.0 §1.6.2), Spain (art. 24.1 RD 1624/1992) and Mexico.
      //
      // No single `correctionModel` value can hold this, and no default can guess it. If this test
      // ever passes with a flattened model, the model is lying.
      expect(statusOf(routesOn('FR', '2026-09-02'), 'INTERNAL_CREDIT_NOTE')).toBe('REQUIRED');
      expect(statusOf(routesOn('IT', '2026-09-02'), 'INTERNAL_CREDIT_NOTE')).toBe('REQUIRED');

      expect(statusOf(routesOn('PL', '2026-09-02'), 'INTERNAL_CREDIT_NOTE')).toBe('FORBIDDEN');
      expect(statusOf(routesOn('ES', '2026-09-02'), 'INTERNAL_CREDIT_NOTE')).toBe('FORBIDDEN');
      expect(statusOf(routesOn('MX', '2026-09-02'), 'INTERNAL_CREDIT_NOTE')).toBe('FORBIDDEN');
    });

    it('no route carries the same status across all seven pivots', () => {
      // Including CREDIT_NOTE, which every profile used to declare as its single model. The claim is
      // measured rather than asserted country by country, so a future profile cannot quietly restore
      // uniformity.
      const ROUTES: CorrectionRoute[] = [
        'CREDIT_NOTE',
        'DEBIT_NOTE',
        'CORRECTIVE_INVOICE',
        'CANCEL_AND_REPLACE',
        'INTERNAL_CREDIT_NOTE',
        'AUTHORITY_ANNULMENT',
        'RESUBMIT_SAME_IDENTITY',
      ];
      const uniform = ROUTES.filter((route) => {
        const statuses = new Set(PIVOTS.map((cc) => statusOf(routesOn(cc, '2026-09-02'), route)));
        return statuses.size === 1;
      });
      expect(uniform).toEqual([]);
    });
  });

  describe('transmission is an axis of its own', () => {
    it('FR and IT require a correction document whose transmission is forbidden', () => {
      // A route can be REQUIRED and untransmittable at the same time. Folding transmission into the
      // status would lose whichever half was dropped — and it is the transmission half that P3-T03
      // has to act on, because correctInvoice() issues and then sends, unconditionally.
      for (const cc of ['FR', 'IT']) {
        const blocked = untransmittableRoutes(routesOn(cc, '2026-09-02'));
        expect(blocked.map((r) => r.route)).toContain('INTERNAL_CREDIT_NOTE');
        expect(blocked.every((r) => r.status === 'REQUIRED')).toBe(true);
      }
    });

    it('no other pivot forbids a transmission', () => {
      for (const cc of ['PL', 'DE', 'ES', 'MX', 'US']) {
        expect(untransmittableRoutes(routesOn(cc, '2026-09-02'))).toEqual([]);
      }
    });
  });

  describe('direction — the Italian asymmetry, and the Polish symmetry', () => {
    it('IT compels the increase and merely permits the decrease', () => {
      // Art. 26 DPR 633/72: comma 1 "devono essere osservate" against comma 2 "ha diritto di".
      const it = routesOn('IT', '2026-09-02');
      expect(statusOf(it, 'DEBIT_NOTE')).toBe('REQUIRED');
      expect(statusOf(it, 'CREDIT_NOTE')).toBe('OPEN');

      expect(routesForDirection(it, 'INCREASE').map((r) => r.route)).toContain('DEBIT_NOTE');
      expect(routesForDirection(it, 'DECREASE').map((r) => r.route)).not.toContain('DEBIT_NOTE');
    });

    it('PL answers the same question with one instrument for both directions', () => {
      // The exact inverse: art. 106j ust. 1 is direction-neutral, so both single-direction documents
      // are forbidden AS DISTINCT DOCUMENTS and the corrective invoice serves either way.
      const pl = routesOn('PL', '2026-09-02');
      expect(statusOf(pl, 'DEBIT_NOTE')).toBe('FORBIDDEN');
      expect(statusOf(pl, 'CREDIT_NOTE')).toBe('FORBIDDEN');
      expect(statusOf(pl, 'CORRECTIVE_INVOICE')).toBe('REQUIRED');

      for (const dir of ['INCREASE', 'DECREASE'] as const) {
        expect(routesForDirection(pl, dir).map((r) => r.route)).toContain('CORRECTIVE_INVOICE');
      }
    });
  });

  describe('the derived model', () => {
    it('MX now resolves to CANCEL_AND_REPLACE — the dead affordance comes alive', () => {
      // Before P3-T02 no shipped profile declared CANCEL_AND_REPLACE, so the `cancelAndReplace`
      // action computed by invoices.helpers.ts was structurally false everywhere, while the strategy,
      // the API field, the front-end type and the translations all existed. Mexico is the country
      // that actually requires the route.
      expect(resolve(tx('MX', '2026-09-02')).lifecycle.correctionModel).toBe('CANCEL_AND_REPLACE');
      expect(isAvailable(routesOn('MX', '2026-09-02'), 'CANCEL_AND_REPLACE')).toBe(true);
    });

    it('DE and ES resolve to CORRECTIVE_INVOICE, not CREDIT_NOTE', () => {
      // Germany's route is a Rechnungsberichtigung referencing the original (§ 31 Abs. 5 UStDV);
      // Spain's is the factura rectificativa (art. 15 RD 1619/2012, "será obligatoria"). Both
      // profiles previously declared a credit note — a route that is open in Germany and never
      // compelled, and in Spain merely the negative-signed form of the rectificativa.
      expect(resolve(tx('DE', '2026-09-02')).lifecycle.correctionModel).toBe('CORRECTIVE_INVOICE');
      expect(resolve(tx('ES', '2026-09-02')).lifecycle.correctionModel).toBe('CORRECTIVE_INVOICE');
    });

    it('FR, IT and US keep CREDIT_NOTE — nothing compels them, so nothing is reordered', () => {
      // The reason the open tier has its own precedence. In the United States every route is `OPEN`
      // only because no text forbids it; flipping the country to CORRECTIVE_INVOICE because a list
      // was sorted that way would invent a rule out of a sourced negative.
      for (const cc of ['FR', 'IT', 'US']) {
        expect(`${cc}: ${resolve(tx(cc, '2026-09-02')).lifecycle.correctionModel}`).toBe(
          `${cc}: CREDIT_NOTE`,
        );
      }
    });

    it('an unresearched country still behaves exactly as before', () => {
      // Absent routes must mean "not researched", never "no route exists". The derivation falls back
      // to the value every profile shipped with, so adding this field changed nothing for the ~100
      // jurisdictions the research did not cover.
      const jp = defaultRegistry.resolve('JP').profile;
      expect(jp.lifecycle.every((t) => t.value.correctionRoutes === undefined)).toBe(true);
      expect(primaryCorrectionModel(undefined)).toBe('CREDIT_NOTE');
    });
  });

  describe('temporality', () => {
    it("PL's buyer loses its only instrument on 2026-02-01", () => {
      // The nota korygująca, repealed by Dz.U. 2023 poz. 1598 art. 1 pkt 15, its date moved to
      // 2026-02-01 by Dz.U. 2024 poz. 852. After that date no Polish BUYER can correct anything.
      expect(statusOf(routesOn('PL', '2026-03-01'), 'BUYER_CORRECTION_NOTE')).toBe('FORBIDDEN');
      expect(statusOf(routesOn('PL', '2025-06-01'), 'BUYER_CORRECTION_NOTE')).toBeUndefined();
    });

    it("FR's internal credit note appears only once the issuer is in the PPF flux", () => {
      // The rule is a flux-layer rule, not a VAT one: the substantive law (CGI 272, 289 I 5) is
      // unchanged by the mandate, so only the routes that describe the flux are dated.
      expect(statusOf(routesOn('FR', '2026-09-02'), 'INTERNAL_CREDIT_NOTE')).toBe('REQUIRED');
      expect(statusOf(routesOn('FR', '2025-06-01'), 'INTERNAL_CREDIT_NOTE')).toBeUndefined();
      // …while the substantive routes are there on both sides of the date.
      expect(statusOf(routesOn('FR', '2025-06-01'), 'ANNOTATED_DUPLICATE')).toBe('REQUIRED');
    });

    it("IT's scarto routes appear only with the SdI", () => {
      expect(statusOf(routesOn('IT', '2026-09-02'), 'INTERNAL_CREDIT_NOTE')).toBe('REQUIRED');
      expect(statusOf(routesOn('IT', '2018-06-01'), 'INTERNAL_CREDIT_NOTE')).toBeUndefined();
      expect(statusOf(routesOn('IT', '2018-06-01'), 'DEBIT_NOTE')).toBe('REQUIRED');
    });
  });

  describe('carve-outs', () => {
    it('FR forbids the credit note on an unpaid invoice and requires an annotated duplicate instead', () => {
      // One route, two statuses, decided by the case — and the remedy France substitutes is a route
      // the plan's own vocabulary did not contain. `statusOf` returns the general rule; the carve-out
      // is the second entry.
      const fr = routesOn('FR', '2026-09-02');
      const creditNotes = (fr ?? []).filter((r) => r.route === 'CREDIT_NOTE');
      expect(creditNotes.map((r) => r.status)).toEqual(['OPEN', 'FORBIDDEN']);
      expect(creditNotes[1].appliesTo).toMatch(/[Ii]mpayé/);
      expect(statusOf(fr, 'ANNOTATED_DUPLICATE')).toBe('REQUIRED');
    });

    it('ES forbids cancel-and-replace except in exchange for a simplified invoice', () => {
      const es = routesOn('ES', '2026-09-02');
      const cnr = (es ?? []).filter((r) => r.route === 'CANCEL_AND_REPLACE');
      expect(cnr.map((r) => r.status)).toEqual(['FORBIDDEN', 'OPEN']);
      expect(cnr[1].appliesTo).toMatch(/simplifi/i);
    });
  });
});
