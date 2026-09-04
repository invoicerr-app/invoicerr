/**
 * Content-pinning + schema-gate spec for `data/si.json` — the AGENT PAYS SI deliverable (lot 7,
 * TODO_DOCUMENTS.md vague B, dernier lot). Same rationale as `data/hr.spec.ts`: reads `si.json`
 * straight off disk rather than through `data/all.ts` (wiring "si" in is a mandataire decision),
 * and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertValidCorrectionRouteFact,
  CORRECTION_ROUTE_IDS,
  CorrectionRouteFact,
  CountryCorrectionRoutesFile,
} from '../schema';

function loadSi(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'si.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

function routeFor(file: CountryCorrectionRoutesFile, routeId: string): CorrectionRouteFact {
  const route = file.routes.find((r) => r.routeId === routeId);
  if (!route) throw new Error(`No route ${routeId} in data/si.json`);
  return route;
}

describe('SI — correction-routes/data/si.json', () => {
  const si = loadSi();

  it('declares countryCode "SI", matching its own filename', () => {
    expect(si.countryCode).toBe('SI');
  });

  it('declares exactly the eleven canonical routes, no duplicates, no invented route', () => {
    const declared = si.routes.map((r) => r.routeId).sort();
    expect(declared).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(declared).size).toBe(11);
  });

  it('every route passes the load-time provenance/status-coupling gate (mirrors what data/all.ts would run)', () => {
    for (const route of si.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'data/si.json')).not.toThrow();
    }
  });

  it('exactly three routes are "legal" (CREDIT_NOTE, DEBIT_NOTE, CORRECTIVE_INVOICE) — the rest honestly "unverified"', () => {
    const legal = si.routes
      .filter((r) => r.provenance.kind === 'legal')
      .map((r) => r.routeId)
      .sort();
    expect(legal).toEqual(['CORRECTIVE_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].sort());
    const unverified = si.routes.filter((r) => r.status === 'unverified');
    expect(unverified.length).toBe(8);
  });

  it('CREDIT_NOTE is "allowed", sourced to ZDDV-1 39. člen drugi odstavek (a written-notice-conditioned faculty, not a named instrument)', () => {
    const route = routeFor(si, 'CREDIT_NOTE');
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toBe(
        'Pri preklicu naročila, vračilu ali znižanju cene po opravljeni dobavi se davčna osnova ustrezno zmanjša. Davčni zavezanec lahko popravi (zmanjša) znesek obračunanega DDV, če pisno obvesti kupca o znesku DDV, za katerega kupec nima pravice do odbitka.',
      );
      expect(route.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(route.notes).toMatch(/39\. člen/);
    expect(route.notes).toMatch(/dobropis/);
  });

  it('DEBIT_NOTE and CORRECTIVE_INVOICE both reuse the SAME 81. člen deveti odstavek assimilation clause, verbatim', () => {
    const debit = routeFor(si, 'DEBIT_NOTE');
    const corrective = routeFor(si, 'CORRECTIVE_INVOICE');
    expect(debit.status).toBe('allowed');
    expect(corrective.status).toBe('allowed');
    expect(debit.provenance.kind).toBe('legal');
    expect(corrective.provenance.kind).toBe('legal');
    if (debit.provenance.kind === 'legal' && corrective.provenance.kind === 'legal') {
      expect(debit.provenance.sourceText).toBe(corrective.provenance.sourceText);
      expect(debit.provenance.sourceText).toBe(
        'Kot račun se šteje tudi vsak dokument oziroma sporočilo, ki spreminja prvoten račun in se nanj nedvoumno nanaša.',
      );
    }
    expect(debit.notes).toMatch(/bremepis/);
    expect(corrective.notes).toMatch(/83\. člen/);
  });

  it('CANCEL_AND_REPLACE and AUTHORITY_ANNULMENT are unverified — no clearance authority identified for SI e-računi, today or under the not-yet-applicable ZIERDED', () => {
    const cancelAndReplace = routeFor(si, 'CANCEL_AND_REPLACE');
    const authorityAnnulment = routeFor(si, 'AUTHORITY_ANNULMENT');
    expect(cancelAndReplace.status).toBe('unverified');
    expect(authorityAnnulment.status).toBe('unverified');
    if (cancelAndReplace.provenance.kind === 'unverified') {
      expect(cancelAndReplace.provenance.resolutionNote).toMatch(/DÉCENTRALISÉ/);
    }
  });

  it('COUNTERPARTY_OBJECTION documents the ZIERDED "zavrnitev" feedback-message CAPABILITY as real but legally inconclusive (no stated legal effect, unlike HR čl. 52)', () => {
    const route = routeFor(si, 'COUNTERPARTY_OBJECTION');
    expect(route.status).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/ZAVRNITVI/);
      expect(route.provenance.resolutionNote).toMatch(/17\. člen/);
      expect(route.provenance.resolutionNote).toMatch(/EFFET JURIDIQUE/);
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW share the same undecided ZDDV-1 39. člen bad-debt finding, cross-referenced rather than duplicated', () => {
    const ledger = routeFor(si, 'LEDGER_ANNOTATION');
    const noDocument = routeFor(si, 'NO_DOCUMENT_BY_LAW');
    expect(ledger.status).toBe('unverified');
    expect(noDocument.status).toBe('unverified');
    if (ledger.provenance.kind === 'unverified') {
      expect(ledger.provenance.resolutionNote).toMatch(/tretji in četrti odstavek/);
    }
    if (noDocument.provenance.kind === 'unverified') {
      expect(noDocument.provenance.resolutionNote).toMatch(/LEDGER_ANNOTATION/);
    }
  });

  it('the file-level notes documents the two primary sources (ZDDV-1, ZIERDED), the PISRS API access method, and the B2G_COVERAGE.md non-contradiction', () => {
    expect(si.notes ?? '').toMatch(/Zakon o davku na dodano vrednost/);
    expect(si.notes ?? '').toMatch(/ZIERDED/);
    expect(si.notes ?? '').toMatch(/pisrs\.si/);
    expect(si.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
    expect(si.notes ?? '').toMatch(/TROIS voies sourcées 'legal'/);
  });
});
