/**
 * CZ — direct-load content spec, added by the CZ country agent (TODO_DOCUMENTS.md, vague B, lot 6).
 * Same rationale as correction-routes/data/ie.spec.ts: reads `cz.json` straight off disk rather than
 * through `data/all.ts`, and re-runs the exact load-time gate (`assertValidCorrectionRouteFact`)
 * independently. No YAML pivot covers CZ (docs/compliance/CORRECTION-ROUTES.yaml meta.covered =
 * [FR, IT, PL, DE, ES, MX, US]) — this is a first direct C1-level read, like ie.json's own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadCz(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'cz.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('CZ — correction-routes/data/cz.json', () => {
  const cz = loadCz();

  it('declares countryCode CZ and exactly the eleven canonical routes, once each', () => {
    expect(cz.countryCode).toBe('CZ');
    const ids = cz.routes.map((r) => r.routeId);
    expect(ids.length).toBe(CORRECTION_ROUTE_IDS.length);
    expect(new Set(ids)).toEqual(new Set(CORRECTION_ROUTE_IDS));
  });

  it('every route passes the load-time gate (status/provenance.kind coupling included)', () => {
    for (const route of cz.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'cz.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "forbidden" AS A DISTINCT INSTRUMENT — not forbidden in substance — because ZDPH § 45 gives ONE instrument (opravný daňový doklad) for both directions, same structure as pl.json\'s own CREDIT_NOTE', () => {
    const creditNote = cz.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('forbidden');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toBe(
        'Opravný daňový doklad je daňový doklad, který se vystavuje při opravě základu nebo výše daně',
      );
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(creditNote.notes).toMatch(/EN TANT QUE DOCUMENT DISTINCT/);
    expect(creditNote.notes).toMatch(/dobropis/);
  });

  it('DEBIT_NOTE is "forbidden" for the SAME reason — § 45 odst. 5 explicitly allows the SAME instrument to be issued when the correction INCREASES the tax amount', () => {
    const debitNote = cz.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(debitNote.status).toBe('forbidden');
    expect(debitNote.provenance.kind).toBe('legal');
    if (debitNote.provenance.kind === 'legal') {
      expect(debitNote.provenance.sourceText).toBe(
        'Opravný daňový doklad lze vystavit i v případě, že je opravou zvyšována výše daně, pokud plátce ' +
          'přiznal daň jinak, než stanoví tento zákon, a tím snížil daň na výstupu.',
      );
    }
    expect(debitNote.notes).toMatch(/vrubopis/);
  });

  it('CORRECTIVE_INVOICE is "required" — ZDPH § 42 odst. 5, mandatory ("je povinen") with a 15-day deadline, amending the original BY REFERENCE (evidenční číslo původního daňového dokladu)', () => {
    const correctiveInvoice = cz.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(correctiveInvoice.status).toBe('required');
    expect(correctiveInvoice.provenance.kind).toBe('legal');
    if (correctiveInvoice.provenance.kind === 'legal') {
      expect(correctiveInvoice.provenance.sourceText).toBe(
        'Plátce je povinen vystavit opravný daňový doklad a vynaložit úsilí, které po něm lze rozumně ' +
          'požadovat, k tomu, aby se tento daňový doklad dostal do dispozice příjemce plnění do 15 dnů ' +
          'ode dne uvedeného v odstavci 3.',
      );
    }
    expect(correctiveInvoice.notes).toMatch(/evidenční číslo původního daňového dokladu/);
    expect(correctiveInvoice.notes).toMatch(/LEDGER_ANNOTATION/);
  });

  it('LEDGER_ANNOTATION is "allowed" — ZDPH § 42 odst. 4, a GENERAL statutory ledger-only alternative (not limited to bad debt, unlike ie.json\'s own LEDGER_ANNOTATION) whenever no original tax document existed or the counterparty is not sufficiently known', () => {
    const ledger = cz.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    expect(ledger.status).toBe('allowed');
    expect(ledger.provenance.kind).toBe('legal');
    if (ledger.provenance.kind === 'legal') {
      expect(ledger.provenance.sourceText).toMatch(/evidenci pro účely daně z přidané hodnoty/);
      expect(ledger.provenance.sourceText).toMatch(/neměl povinnost vystavit daňový doklad/);
    }
    expect(ledger.notes).toMatch(/PLUS LARGE/);
    expect(ledger.notes).toMatch(/§ 43 odst\. 2/);
  });

  it('CANCEL_AND_REPLACE stays "unverified" — unlike ie.json (VATCA s. 67(3), a narrow wrong-rate cancel-then-reissue clause), no equivalent two-step sequence was found in ZDPH § 42/§ 43/§ 45', () => {
    const cancelAndReplace = cz.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(cancelAndReplace.status).toBe('unverified');
    expect(cancelAndReplace.provenance.kind).toBe('unverified');
    if (cancelAndReplace.provenance.kind === 'unverified') {
      expect(cancelAndReplace.provenance.resolutionNote).toMatch(/Irlande/);
    }
  });

  it('ANNOTATED_DUPLICATE stays "unverified" with an explicit NEGATIVE keyword search over the full ZDPH text ("duplikát", "náhradní doklad") — zero hits, honestly reported', () => {
    const annotatedDuplicate = cz.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(annotatedDuplicate.status).toBe('unverified');
    if (annotatedDuplicate.provenance.kind === 'unverified') {
      expect(annotatedDuplicate.provenance.resolutionNote).toMatch(/duplikát/);
    }
    expect(annotatedDuplicate.notes).toMatch(/négative/i);
  });

  it('the file-level notes name the headline finding (opravný daňový doklad as the single instrument for both directions) and flag the two negative keyword searches ("dobropis"/"vrubopis", "duplikát"/"náhradní doklad")', () => {
    expect(cz.notes).toMatch(/opravný daňový doklad/);
    expect(cz.notes).toMatch(/INSTRUMENT UNIQUE/);
    expect(cz.notes).toMatch(/dobropis.*vrubopis|vrubopis.*dobropis/);
  });

  it("no route silently reuses another route's exact sourceText — CREDIT_NOTE, DEBIT_NOTE and CORRECTIVE_INVOICE each cite a distinct clause of ZDPH § 42/§ 43/§ 45", () => {
    const legalTexts = cz.routes
      .filter((r) => r.provenance.kind === 'legal')
      .map((r) => (r.provenance as { sourceText: string }).sourceText);
    expect(new Set(legalTexts).size).toBe(legalTexts.length);
  });
});
