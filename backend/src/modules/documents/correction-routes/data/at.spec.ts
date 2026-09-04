/**
 * Content-pinning + schema-gate spec for `data/at.json` — the AGENT PAYS AT deliverable (lot 1,
 * TODO_DOCUMENTS.md vague B). Reads `at.json` directly (no `all.ts`/`all.spec.ts` — those stay
 * mandataire-only, and `at` is not registered in `all.ts`'s own `COUNTRY_FILES` list) and re-runs
 * `assertValidCorrectionRouteFact` — the same gate `all.ts` would run once this file is wired in.
 *
 * AT is NOT covered by `docs/compliance/CORRECTION-ROUTES.yaml` (its own `meta.covered` lists only
 * FR/IT/PL/DE/ES/MX/US) — this file is a first, direct read of the UStG 1994 (niveau de preuve C1,
 * per the task brief), not a transcription of that YAML. This spec pins that fact too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertValidCorrectionRouteFact,
  CORRECTION_ROUTE_IDS,
  CorrectionRouteFact,
  CountryCorrectionRoutesFile,
} from '../schema';

function loadAt(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'at.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

function routeFor(file: CountryCorrectionRoutesFile, routeId: string): CorrectionRouteFact {
  const route = file.routes.find((r) => r.routeId === routeId);
  if (!route) throw new Error(`No route "${routeId}" in data/at.json`);
  return route;
}

describe('AT — correction-routes/data/at.json', () => {
  const at = loadAt();

  it('declares countryCode "AT", matching its own filename', () => {
    expect(at.countryCode).toBe('AT');
  });

  it('declares exactly the eleven canonical routes, one entry each — no more, no fewer', () => {
    const declared = at.routes.map((r) => r.routeId).sort();
    expect(declared).toEqual([...CORRECTION_ROUTE_IDS].sort());
  });

  it('every route passes the load-time gate (mirrors what data/all.ts would run once AT is wired in)', () => {
    for (const route of at.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'data/at.json')).not.toThrow();
    }
  });

  it('CORRECTIVE_INVOICE is the one route promoted to "legal", sourced to UStG 1994 §11 Abs. 12', () => {
    const route = routeFor(at, 'CORRECTIVE_INVOICE');
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    const sourceText = (route.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/berichtigt die Rechnung/);
    expect(route.notes).toMatch(/§11 Abs\. 12/);
  });

  it('every other route stays "unverified" — a real, honest first pass, nothing promoted by reasoning', () => {
    const others = at.routes.filter((r) => r.routeId !== 'CORRECTIVE_INVOICE');
    expect(others).toHaveLength(10);
    for (const route of others) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
    }
  });

  it('CREDIT_NOTE and INTERNAL_CREDIT_NOTE both flag the Gutschrift (self-billing) false friend', () => {
    for (const routeId of ['CREDIT_NOTE', 'INTERNAL_CREDIT_NOTE']) {
      const route = routeFor(at, routeId);
      const text =
        (route.provenance.kind === 'unverified' ? route.provenance.resolutionNote : '') + (route.notes ?? '');
      expect(text).toMatch(/Gutschrift/);
    }
  });

  it('the file-level notes documents that AT is not (yet) covered by CORRECTION-ROUTES.yaml', () => {
    expect(at.notes ?? '').toMatch(/CORRECTION-ROUTES\.yaml/);
    expect(at.notes ?? '').toMatch(/PAS TRANSCRIT|pas encore/i);
  });
});
