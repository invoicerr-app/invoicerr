/**
 * Content-pinning + schema-gate spec for `data/cy.json` — the AGENT PAYS CY deliverable (lot 2,
 * TODO_DOCUMENTS.md vague B). Reads `cy.json` directly (no `all.ts`/`all.spec.ts` — those stay
 * mandataire-only, and `cy` is not registered in `all.ts`'s own `COUNTRY_FILES` list) and re-runs
 * `assertValidCorrectionRouteFact` — the same gate `all.ts` would run once this file is wired in.
 *
 * CY is NOT covered by `docs/compliance/CORRECTION-ROUTES.yaml` (its own `meta.covered` lists only
 * FR/IT/PL/DE/ES/MX/US) — this file is a first, direct read of the Ν.95(Ι)/2000 VAT Law (niveau de
 * preuve C1, per the task brief), not a transcription of that YAML. This spec pins that fact too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertValidCorrectionRouteFact,
  CORRECTION_ROUTE_IDS,
  CorrectionRouteFact,
  CountryCorrectionRoutesFile,
} from '../schema';

function loadCy(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'cy.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

function routeFor(file: CountryCorrectionRoutesFile, routeId: string): CorrectionRouteFact {
  const route = file.routes.find((r) => r.routeId === routeId);
  if (!route) throw new Error(`No route "${routeId}" in data/cy.json`);
  return route;
}

describe('CY — correction-routes/data/cy.json', () => {
  const cy = loadCy();

  it('declares countryCode "CY", matching its own filename', () => {
    expect(cy.countryCode).toBe('CY');
  });

  it('declares exactly the eleven canonical routes, one entry each — no more, no fewer', () => {
    const declared = cy.routes.map((r) => r.routeId).sort();
    expect(declared).toEqual([...CORRECTION_ROUTE_IDS].sort());
  });

  it('every route passes the load-time gate (mirrors what data/all.ts would run once CY is wired in)', () => {
    for (const route of cy.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'data/cy.json')).not.toThrow();
    }
  });

  it('CORRECTIVE_INVOICE is the one route promoted to "legal", sourced to the Tenth Schedule (art. 43) para. 2', () => {
    const route = routeFor(cy, 'CORRECTIVE_INVOICE');
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    const sourceText = (route.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/τιμολόγιο Φ\.Π\.Α/);
    expect(sourceText).toMatch(/προορίζεται να το τροποποιήσει/);
  });

  it('every other route stays "unverified" — a real, honest first pass, nothing promoted by reasoning', () => {
    const others = cy.routes.filter((r) => r.routeId !== 'CORRECTIVE_INVOICE');
    expect(others).toHaveLength(10);
    for (const route of others) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
    }
  });

  it('CREDIT_NOTE and DEBIT_NOTE both document the negative full-text search for a named CY instrument', () => {
    for (const routeId of ['CREDIT_NOTE', 'DEBIT_NOTE']) {
      const route = routeFor(cy, routeId);
      const note = route.provenance.kind === 'unverified' ? route.provenance.resolutionNote : '';
      expect(note).toMatch(/πιστωτικό σημείωμα|χρεωστικό σημείωμα/);
    }
  });

  it('AUTHORITY_ANNULMENT and COUNTERPARTY_OBJECTION are explicitly not promoted by analogy with another country', () => {
    for (const routeId of ['AUTHORITY_ANNULMENT', 'COUNTERPARTY_OBJECTION']) {
      const route = routeFor(cy, routeId);
      expect(route.notes ?? '').toMatch(/PAS promu(e)? par analogie/);
    }
  });

  it('the file-level notes documents that CY is not (yet) covered by CORRECTION-ROUTES.yaml', () => {
    expect(cy.notes ?? '').toMatch(/CORRECTION-ROUTES\.yaml/);
    expect(cy.notes ?? '').toMatch(/PAS DE PIVOT|pas encore/i);
  });

  it('the file-level notes names the Κανονισμοί (implementing Regulations) as the real access wall', () => {
    expect(cy.notes ?? '').toMatch(/Κανονισμοί/);
  });
});
