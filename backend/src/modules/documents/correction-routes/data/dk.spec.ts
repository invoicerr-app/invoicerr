/**
 * DK — direct-load content spec, added by the DK country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as correction-routes/data/lv.spec.ts: reads `dk.json` straight off disk rather than
 * through `data/all.ts` (wiring "dk" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidCorrectionRouteFact`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadDk(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'dk.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('DK — correction-routes/data/dk.json', () => {
  const dk = loadDk();

  it('declares countryCode DK with all eleven canonical routes, no duplicates, no extra route', () => {
    expect(dk.countryCode).toBe('DK');
    const ids = dk.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time provenance/status coupling gate', () => {
    for (const route of dk.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'dk.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "required" (MANDATORY, "skal udstedes"), momsloven § 52 a stk. 5, reinforced by § 27 stk. 4, using the dedicated term "kreditnota"', () => {
    const cn = dk.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(cn.status).toBe('required');
    expect(cn.provenance.kind).toBe('legal');
    if (cn.provenance.kind === 'legal') {
      expect(cn.provenance.sourceText).toBe(
        'Hvis varer bliver returneret efter fakturaens udstedelse, skal der udstedes kreditnota. Det ' +
          'samme gælder, hvis leverandøren efter fakturaens udstedelse giver afslag i prisen.',
      );
    }
    // tripwire: the reinforcing § 27 stk. 4 fragment, a distinctive fragment a paraphrase would drop.
    expect(cn.notes).toMatch(/§ 27, stk\. 4/);
    expect(cn.notes).toMatch(/betinget af, at der udstedes kreditnota/);
  });

  it('DEBIT_NOTE is "required" too (same imperative "skal udstedes"), momsloven § 52 a stk. 5 3. pkt. — but WITHOUT a dedicated Danish term, unlike CREDIT_NOTE', () => {
    const dn = dk.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(dn.status).toBe('required');
    expect(dn.provenance.kind).toBe('legal');
    if (dn.provenance.kind === 'legal') {
      expect(dn.provenance.sourceText).toBe(
        'Hvis der sker efterbetaling, skal der udstedes faktura over efterbetalingen.',
      );
    }
    // tripwire: the honest absence-of-dedicated-term caveat must survive any rewrite.
    expect(dn.notes).toMatch(/aucun terme dédié/);
    expect(dn.notes).toMatch(/debitnota/);
  });

  it('CORRECTIVE_INVOICE is "allowed" via momsbekendtgørelsen § 58 stk. 2 general assimilation clause — the SAME sourceText DEBIT_NOTE composes with, never a copy pretending to be independent', () => {
    const ci = dk.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(ci.status).toBe('allowed');
    expect(ci.provenance.kind).toBe('legal');
    if (ci.provenance.kind === 'legal') {
      expect(ci.provenance.sourceText).toBe(
        'Ethvert dokument eller enhver meddelelse, der specifikt og utvetydigt ændrer eller henviser ' +
          'til den oprindelige faktura, sidestilles med en faktura.',
      );
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW stay "unverified", sharing the SAME real-but-undecided finding (momsloven § 27 stk. 6, the 80% — not 100% — bad-debt reduction, silent on the documentary vehicle)', () => {
    const la = dk.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const nd = dk.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    expect(la.status).toBe('unverified');
    expect(nd.status).toBe('unverified');
    expect(la.provenance.kind).toBe('unverified');
    if (la.provenance.kind === 'unverified') {
      expect(la.provenance.resolutionNote).toMatch(/uerholdelige fordringer/);
      expect(la.provenance.resolutionNote).toMatch(/80 pct/);
    }
    // tripwire: NO_DOCUMENT_BY_LAW's own note must point back at LEDGER_ANNOTATION rather than
    // duplicating (and risking diverging from) the same reasoning.
    expect(nd.provenance.kind).toBe('unverified');
    if (nd.provenance.kind === 'unverified') {
      expect(nd.provenance.resolutionNote).toMatch(/LEDGER_ANNOTATION/);
    }
  });

  it('the eight non-mandatory routes are all "unverified" with a non-empty resolutionNote each', () => {
    const mandatoryOrAllowed = new Set(['CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE']);
    const rest = dk.routes.filter((r) => !mandatoryOrAllowed.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('file-level notes document no B2G routing is modeled here (DK stays "pas livrable" per B2G_COVERAGE.md, OIOUBL not vendored) and flag the DEBIT_NOTE "required" finding against the YAML vocabulary caveat', () => {
    expect(dk.notes).toMatch(/OIOUBL/);
    expect(dk.notes).toMatch(/B2G_COVERAGE\.md/);
    expect(dk.notes?.match(/DEBIT_NOTE/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
