/**
 * HR — direct-load content spec, added by the HR country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as correction-routes/data/ee.spec.ts: reads `hr.json` straight off disk rather than
 * through `data/all.ts` (wiring "hr" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidCorrectionRouteFact`) independently.
 *
 * HR has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, grounded in TWO primary legal texts read verbatim by direct curl on zakon.hr
 * (static law pages, never a fetch-résumé tool): the Zakon o porezu na dodanu vrijednost (ZPDV) and
 * the Zakon o fiskalizaciji (NN 89/25 — "Fiskalizacija 2.0", the mandatory B2B eRačun reform).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadHr(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'hr.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('HR — correction-routes/data/hr.json', () => {
  const hr = loadHr();

  it('declares countryCode HR and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(hr.countryCode).toBe('HR');
    const ids = hr.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of hr.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'hr.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "allowed", grounded in ZPDV čl. 33 st. 7/8 — a base-reduction-plus-notification mechanism, not a named instrument', () => {
    const route = hr.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toMatch(/obavijesti o provedenom ispravku/);
      expect(route.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE and DEBIT_NOTE are BOTH "allowed", grounded in the SAME ZPDV čl. 78 st. 7 general document-deemed-an-invoice clause', () => {
    const corrective = hr.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    const debit = hr.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    for (const route of [corrective, debit]) {
      expect(route.status).toBe('allowed');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toBe(
          'Svaka isprava ili obavijest koja mijenja prvobitni račun i koja se izričito i nedvojbeno odnosi na njega smatra se računom.',
        );
      }
    }
  });

  it('ANNOTATED_DUPLICATE is "allowed", grounded in the Zakon o fiskalizaciji čl. 43 same-number reissue for tax-neutral corrections — a first for this catalogue', () => {
    const route = hr.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toMatch(/ne utječe na obračun poreza/);
      expect(route.provenance.sourceText).toMatch(/indikator kopije računa/);
    }
    expect(route.notes).toMatch(/čl\. 43/);
  });

  it('COUNTERPARTY_OBJECTION is "allowed", grounded in the Zakon o fiskalizaciji čl. 52 recipient-rejection-reported-to-the-tax-authority mechanism', () => {
    const route = hr.routes.find((r) => r.routeId === 'COUNTERPARTY_OBJECTION')!;
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toMatch(
        /dostaviti podatke o eRačunima za koje je izvršio odbijanje/,
      );
      expect(route.provenance.sourceText).toMatch(/neće koristiti pravo na pretporez/);
    }
    expect(route.notes).toMatch(/čl\. 52/);
  });

  it('the other six routes are honestly "unverified"', () => {
    const legalIds = new Set([
      'CREDIT_NOTE',
      'CORRECTIVE_INVOICE',
      'DEBIT_NOTE',
      'ANNOTATED_DUPLICATE',
      'COUNTERPARTY_OBJECTION',
    ]);
    const rest = hr.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(6);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("CANCEL_AND_REPLACE documents the real B2C-till-receipt-clearance (art. 12-15, out of this product's scope) versus B2B-eRačun-post-hoc (art. 34-53, in scope) distinction, without conflating the two", () => {
    const route = hr.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/krajnjoj potrošnji/);
      expect(route.provenance.resolutionNote).toMatch(/HORS PÉRIMÈTRE/);
    }
  });

  it("RESUBMIT_SAME_IDENTITY correctly distinguishes itself from ANNOTATED_DUPLICATE and COUNTERPARTY_OBJECTION rather than conflating the same-number-reissue mechanism with this route's own after-rejection definition", () => {
    const route = hr.routes.find((r) => r.routeId === 'RESUBMIT_SAME_IDENTITY')!;
    expect(route.status).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/ANNOTATED_DUPLICATE/);
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same ZPDV čl. 33 st. 11 tax-authority-notification ambiguity, left genuinely undecided between the two', () => {
    const ledger = hr.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = hr.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/st\. 11|LEDGER_ANNOTATION/);
      }
    }
  });

  it('the file-level notes documents the two primary sources, the ANNOTATED_DUPLICATE/COUNTERPARTY_OBJECTION findings, and the deliberate absence of any B2G modeling', () => {
    expect(hr.notes ?? '').toMatch(/Zakon o porezu na dodanu vrijednost/);
    expect(hr.notes ?? '').toMatch(/Zakon o fiskalizaciji/);
    expect(hr.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
  });
});
