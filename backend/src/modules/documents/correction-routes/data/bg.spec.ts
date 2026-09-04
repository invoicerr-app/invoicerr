/**
 * BG — direct-load content spec, added by the BG country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as correction-routes/data/se.spec.ts: reads `bg.json` straight off disk rather than
 * through `data/all.ts` (wiring "bg" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidCorrectionRouteFact`) independently.
 *
 * BG has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, not a transcription, grounded in the PRIMARY legal text (lex.bg's own raw HTML
 * of the ЗДДС, read with no fetch-summary tool involved), not merely an administrative paraphrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadBg(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'bg.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('BG — correction-routes/data/bg.json', () => {
  const bg = loadBg();

  it('declares countryCode BG and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(bg.countryCode).toBe('BG');
    const ids = bg.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of bg.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'bg.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE and DEBIT_NOTE are BOTH "required" — the expected trouvaille: ЗДДС чл. 115 names and MANDATES two distinct directional instruments, not just one', () => {
    const creditNote = bg.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    const debitNote = bg.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    for (const route of [creditNote, debitNote]) {
      expect(route.status).toBe('required');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        // Tripwire: both directional clauses AND the injunctive verb must survive verbatim.
        expect(route.provenance.sourceText).toMatch(/доставчикът е длъжен да издаде известие/);
        expect(route.provenance.sourceText).toMatch(/дебитно известие/);
        expect(route.provenance.sourceText).toMatch(/кредитно известие/);
        expect(route.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('CORRECTIVE_INVOICE is honestly "unverified" — a NEGATIVE search result, unlike gr.json/be.json\'s own general assimilation clause', () => {
    const corrective = bg.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(corrective.status).toBe('unverified');
    expect(corrective.provenance.kind).toBe('unverified');
    if (corrective.provenance.kind === 'unverified') {
      expect(corrective.provenance.resolutionNote).toMatch(/[Rr]echerche textuelle NÉGATIVE/);
      expect(corrective.provenance.resolutionNote).toMatch(/чл\. 115/);
    }
  });

  it('CANCEL_AND_REPLACE documents a REAL чл. 116 mechanism but stays "unverified" because no authority interaction was found (a private bilateral protocol only)', () => {
    const cancelReplace = bg.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(cancelReplace.status).toBe('unverified');
    if (cancelReplace.provenance.kind === 'unverified') {
      expect(cancelReplace.provenance.resolutionNote).toMatch(/анулират и се издават нови/);
      expect(cancelReplace.provenance.resolutionNote).toMatch(/AUCUNE autorité/);
    }
  });

  it('LEDGER_ANNOTATION is "allowed", grounded in чл. 126б ал. 2/5 — a protocol reflected with a MINUS sign in the seller\'s own sales ledger, never sent to the buyer', () => {
    const ledger = bg.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    expect(ledger.status).toBe('allowed');
    expect(ledger.provenance.kind).toBe('legal');
    if (ledger.provenance.kind === 'legal') {
      expect(ledger.provenance.sourceText).toMatch(/чрез издаване на протокол/);
      // Tripwire: the exact "(-)" sign in the ledger — the whole nuance hinges on this detail.
      expect(ledger.provenance.sourceText).toMatch(/се отразява със знак \(-\) в дневника за продажби/);
      expect(ledger.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('NO_DOCUMENT_BY_LAW and ANNOTATED_DUPLICATE are POSITIVE negative searches — the actual mechanism found (LEDGER_ANNOTATION/CREDIT_NOTE) is named in their own resolutionNote, not just "not researched"', () => {
    const noDoc = bg.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    const dup = bg.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    for (const route of [noDoc, dup]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/126/);
      }
    }
    if (dup.provenance.kind === 'unverified') {
      expect(dup.provenance.resolutionNote).toMatch(/LEDGER_ANNOTATION/);
    }
  });

  it("AUTHORITY_ANNULMENT notes the real adjacent finding (чл. 126б ал. 8 — prior NAP authorization above €51,130) without over-claiming a match to this route's exact definition", () => {
    const authAnnul = bg.routes.find((r) => r.routeId === 'AUTHORITY_ANNULMENT')!;
    expect(authAnnul.status).toBe('unverified');
    if (authAnnul.provenance.kind === 'unverified') {
      expect(authAnnul.provenance.resolutionNote).toMatch(/51 130/);
      expect(authAnnul.provenance.resolutionNote).toMatch(/разрешение/);
    }
  });

  it('INTERNAL_CREDIT_NOTE and RESUBMIT_SAME_IDENTITY both note the absence of any domestic clearance authority (B2G_COVERAGE.md, CAIS EPP closed channel)', () => {
    const internal = bg.routes.find((r) => r.routeId === 'INTERNAL_CREDIT_NOTE')!;
    const resubmit = bg.routes.find((r) => r.routeId === 'RESUBMIT_SAME_IDENTITY')!;
    for (const route of [internal, resubmit]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/B2G_COVERAGE\.md/);
        expect(route.provenance.resolutionNote).toMatch(/CAIS EPP/);
      }
    }
  });

  it('COUNTERPARTY_OBJECTION documents a negative textual search on "оспорва"/"възразява"', () => {
    const objection = bg.routes.find((r) => r.routeId === 'COUNTERPARTY_OBJECTION')!;
    expect(objection.status).toBe('unverified');
    if (objection.provenance.kind === 'unverified') {
      expect(objection.provenance.resolutionNote).toMatch(/оспорва/);
      expect(objection.provenance.resolutionNote).toMatch(/възразява/);
    }
  });

  it('file-level notes state there is no CORRECTION-ROUTES.yaml pivot for BG (first direct C1 reading) and name lex.bg as the raw-text source', () => {
    expect(bg.notes).toMatch(/PAS de YAML pivot/);
    expect(bg.notes).toMatch(/lex\.bg/);
    expect(bg.notes).toMatch(/windows-1251/);
  });

  it('exactly three routes reach a positive legal status (required/allowed) — the rest stay honestly unverified', () => {
    const decided = bg.routes.filter((r) => r.status !== 'unverified');
    expect(decided.map((r) => r.routeId).sort()).toEqual(
      ['CREDIT_NOTE', 'DEBIT_NOTE', 'LEDGER_ANNOTATION'].sort(),
    );
  });
});
