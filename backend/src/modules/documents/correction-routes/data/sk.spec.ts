/**
 * SK — direct-load content spec, added by the SK country agent (TODO_DOCUMENTS.md, vague B, lot 7 —
 * dernier lot). Same rationale as correction-routes/data/cz.spec.ts: reads `sk.json` straight off
 * disk rather than through `data/all.ts`, and re-runs the exact load-time gate
 * (`assertValidCorrectionRouteFact`) independently. No YAML pivot covers SK (docs/compliance/
 * CORRECTION-ROUTES.yaml meta.covered = [FR, IT, PL, DE, ES, MX, US]) — this is a first direct
 * C1-level read, like cz.json's own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadSk(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'sk.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('SK — correction-routes/data/sk.json', () => {
  const sk = loadSk();

  it('declares countryCode SK and exactly the eleven canonical routes, once each', () => {
    expect(sk.countryCode).toBe('SK');
    const ids = sk.routes.map((r) => r.routeId);
    expect(ids.length).toBe(CORRECTION_ROUTE_IDS.length);
    expect(new Set(ids)).toEqual(new Set(CORRECTION_ROUTE_IDS));
  });

  it('every route passes the load-time gate (status/provenance.kind coupling included)', () => {
    for (const route of sk.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'sk.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "forbidden" AS A DISTINCT INSTRUMENT — not forbidden in substance — because § 71 ods. 2 gives ONE instrument (the amending faktúra) for both directions, same structure as cz.json\'s own CREDIT_NOTE', () => {
    const creditNote = sk.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(creditNote.status).toBe('forbidden');
    expect(creditNote.provenance.kind).toBe('legal');
    if (creditNote.provenance.kind === 'legal') {
      expect(creditNote.provenance.sourceText).toBe(
        'Za faktúru sa považuje aj každý doklad alebo oznámenie, ktoré mení pôvodnú faktúru a osobitne a ' +
          'jednoznačne sa na ňu vzťahuje.',
      );
      expect(creditNote.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(creditNote.notes).toMatch(/EN TANT QUE DOCUMENT DISTINCT/);
    expect(creditNote.notes).toMatch(/dobropis/);
  });

  it('DEBIT_NOTE is "forbidden" for the SAME reason — § 25 ods. 1 písm. c) puts the INCREASE case in the SAME paragraph as the decrease cases (písm. a-b), no separate instrument', () => {
    const debitNote = sk.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(debitNote.status).toBe('forbidden');
    expect(debitNote.provenance.kind).toBe('legal');
    if (debitNote.provenance.kind === 'legal') {
      expect(debitNote.provenance.sourceText).toBe(
        'Základ dane pri dodaní tovaru alebo služby a pri nadobudnutí tovaru v tuzemsku z iného ' +
          'členského štátu sa opraví a) pri úplnom alebo čiastočnom zrušení dodávky tovaru alebo služby ' +
          'a pri úplnom alebo čiastočnom vrátení dodávky tovaru, b) pri znížení ceny tovaru alebo služby ' +
          'po vzniku daňovej povinnosti, c) pri zvýšení ceny tovaru alebo služby.',
      );
    }
    expect(debitNote.notes).toMatch(/ťarchopis/);
    expect(debitNote.notes).toMatch(/vrubopis/);
  });

  it('CORRECTIVE_INVOICE is "required" — § 73 ods. 1 písm. e), mandatory ("musí byť vyhotovená") with a 15-day-from-month-end deadline, amending the original BY REFERENCE (poradové číslo pôvodnej faktúry, § 74 ods. 3 písm. c))', () => {
    const correctiveInvoice = sk.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(correctiveInvoice.status).toBe('required');
    expect(correctiveInvoice.provenance.kind).toBe('legal');
    if (correctiveInvoice.provenance.kind === 'legal') {
      expect(correctiveInvoice.provenance.sourceText).toMatch(/musí byť vyhotovená do 15 dní/);
      expect(correctiveInvoice.provenance.sourceText).toMatch(/opravy základu dane podľa § 25 ods\. 1/);
    }
    expect(correctiveInvoice.notes).toMatch(/poradové číslo pôvodnej faktúry/);
    expect(correctiveInvoice.notes).toMatch(/NO_DOCUMENT_BY_LAW/);
  });

  it('NO_DOCUMENT_BY_LAW is "allowed" — § 25 ods. 3, the tax adjusts straight into the VAT return with NO document and NO named ledger at all, the German-style route found here in Slovak law', () => {
    const noDoc = sk.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    expect(noDoc.status).toBe('allowed');
    expect(noDoc.provenance.kind).toBe('legal');
    if (noDoc.provenance.kind === 'legal') {
      expect(noDoc.provenance.sourceText).toBe(
        'Ak sa pri oprave základu dane nevyhotovuje doklad o oprave základu dane, uvedie sa rozdiel ' +
          'medzi pôvodným základom dane a opraveným základom dane a rozdiel medzi pôvodnou daňou a ' +
          'opravenou daňou v daňovom priznaní za zdaňovacie obdobie, v ktorom nastala skutočnosť, ktorá ' +
          'má za následok opravu základu dane.',
      );
    }
    expect(noDoc.notes).toMatch(/DE PLEIN DROIT/);
    expect(noDoc.notes).toMatch(/INVERSE du modèle tchèque/);
  });

  it('LEDGER_ANNOTATION stays "unverified" — DELIBERATELY not copied from the Czech template: unlike ZDPH § 42 odst. 4 písm. b), § 25 ods. 3 never names any ledger or register as the alternative to a document', () => {
    const ledger = sk.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    expect(ledger.status).toBe('unverified');
    expect(ledger.provenance.kind).toBe('unverified');
    if (ledger.provenance.kind === 'unverified') {
      expect(ledger.provenance.resolutionNote).toMatch(/CONTRAIREMENT au tchèque/);
      expect(ledger.provenance.resolutionNote).toMatch(/ne nomme AUCUN registre/);
    }
    expect(ledger.notes).toMatch(/MIROIR EXACT/);
    expect(ledger.notes).toMatch(/INVERSÉ/);
  });

  it('CANCEL_AND_REPLACE stays "unverified" — no two-step cancel-then-reissue sequence found in § 25/§ 25a, same conclusion as cz.json', () => {
    const cancelAndReplace = sk.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(cancelAndReplace.status).toBe('unverified');
    expect(cancelAndReplace.provenance.kind).toBe('unverified');
  });

  it('ANNOTATED_DUPLICATE stays "unverified" with an explicit NEGATIVE keyword search over the full zákon o DPH text ("duplikát", "náhradný doklad") — zero hits, honestly reported', () => {
    const annotatedDuplicate = sk.routes.find((r) => r.routeId === 'ANNOTATED_DUPLICATE')!;
    expect(annotatedDuplicate.status).toBe('unverified');
    if (annotatedDuplicate.provenance.kind === 'unverified') {
      expect(annotatedDuplicate.provenance.resolutionNote).toMatch(/duplikát/);
    }
    expect(annotatedDuplicate.notes).toMatch(/négative/i);
  });

  it('the file-level notes name the headline finding (the § 71 ods. 2 faktúra as the single instrument for both directions), the NO_DOCUMENT_BY_LAW/LEDGER_ANNOTATION contrast with cz.json, and pin the § 80a mandate to 1 July 2030 (not 2027)', () => {
    expect(sk.notes).toMatch(/INSTRUMENT UNIQUE/);
    expect(sk.notes).toMatch(/NO_DOCUMENT_BY_LAW/);
    expect(sk.notes).toMatch(/LEDGER_ANNOTATION/);
    expect(sk.notes).toMatch(/385\/2025/);
    expect(sk.notes).toMatch(/1er JUILLET 2030/);
    expect(sk.notes).toMatch(/PAS 2027/);
  });

  it("no route silently reuses another route's exact sourceText — CREDIT_NOTE, DEBIT_NOTE, CORRECTIVE_INVOICE and NO_DOCUMENT_BY_LAW each cite a distinct clause of § 25/§ 71/§ 73", () => {
    const legalTexts = sk.routes
      .filter((r) => r.provenance.kind === 'legal')
      .map((r) => (r.provenance as { sourceText: string }).sourceText);
    expect(new Set(legalTexts).size).toBe(legalTexts.length);
  });
});
