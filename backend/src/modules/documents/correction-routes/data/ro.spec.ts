/**
 * RO — direct-load content spec, added by the RO country agent (TODO_DOCUMENTS.md, vague B, lot 7,
 * last of the lot). Same rationale as correction-routes/data/hr.spec.ts: reads `ro.json` straight off
 * disk rather than through `data/all.ts` (wiring "ro" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * RO has no `docs/compliance/CORRECTION-ROUTES.yaml` entry — this is the first, direct (C1) reading
 * for this country, grounded in the Codul fiscal (Legea 227/2015, art. 287/319/330) plus the RO
 * e-Factura mandate texts (OUG 120/2021, Legea 296/2023, OUG 115/2023, OUG 69/2024), all read verbatim
 * by direct curl + pdftotext on official ANAF-hosted PDFs (static.anaf.ro) — never a fetch-résumé.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadRo(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'ro.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('RO — correction-routes/data/ro.json', () => {
  const ro = loadRo();

  it('declares countryCode RO and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(ro.countryCode).toBe('RO');
    const ids = ro.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of ro.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'ro.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE and DEBIT_NOTE are BOTH "required" (not merely "allowed"), grounded in the SAME Codul fiscal art. 330 alin. (2) mandatory-issuance clause composed with art. 287', () => {
    const creditNote = ro.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    const debitNote = ro.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    for (const route of [creditNote, debitNote]) {
      expect(route.status).toBe('required');
      expect(route.provenance.kind).toBe('legal');
      if (route.provenance.kind === 'legal') {
        expect(route.provenance.sourceText).toMatch(/trebuie să emită facturi/);
        expect(route.provenance.sourceCheckedAt).toBe('2026-09-05');
      }
    }
  });

  it("CREDIT_NOTE's own citation carries the real art. 287 lit. d) bad-debt exception to the buyer-transmission requirement, not silently dropped", () => {
    const route = ro.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toMatch(/cu excepţia situaţiei prevăzute la art\. 287 lit\. d\)/);
    }
    expect(route.notes).toMatch(/art\. 287 lit\. d\)/);
  });

  it("DEBIT_NOTE's own notes are honest that its scope is a REVERSAL of a prior art. 287 reduction, not a general price-increase instrument", () => {
    const route = ro.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(route.notes).toMatch(/REVERSAL/);
    expect(route.notes).toMatch(/se anulează ajustarea efectuată/);
  });

  it('CORRECTIVE_INVOICE is "allowed", grounded in the Codul fiscal art. 330 alin. (1) lit. b) either/or choice between a single amending document and a two-document pair', () => {
    const route = ro.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toMatch(/fie se emite o nouă factură/);
      expect(route.provenance.sourceText).toMatch(/concomitent se emite o factură/);
    }
  });

  it('the other eight routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE']);
    const rest = ro.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(8);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("CANCEL_AND_REPLACE correctly distinguishes the art. 330 alin. (1) lit. a) pre-transmission-to-buyer cancel from the YAML's own authority-side definition, rather than conflating the two", () => {
    const route = ro.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    expect(route.provenance.kind).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/NU A FOST TRANSMISĂ/);
      expect(route.provenance.resolutionNote).toMatch(/AUPRÈS DE L'AUTORITÉ/);
    }
  });

  it('ANNOTATED_DUPLICATE, AUTHORITY_ANNULMENT, RESUBMIT_SAME_IDENTITY and COUNTERPARTY_OBJECTION each document a genuine negative keyword search across the RO e-Factura mandate texts', () => {
    const negativeSearchIds = [
      'ANNOTATED_DUPLICATE',
      'AUTHORITY_ANNULMENT',
      'RESUBMIT_SAME_IDENTITY',
      'COUNTERPARTY_OBJECTION',
    ];
    for (const id of negativeSearchIds) {
      const route = ro.routes.find((r) => r.routeId === id)!;
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/zéro occurrence|ZÉRO occurrence/);
      }
    }
  });

  it('LEDGER_ANNOTATION and NO_DOCUMENT_BY_LAW both document the same art. 330 alin. (2) mandatory-document tension, left genuinely undecided between the two rather than promoted to "forbidden" by structural reasoning alone', () => {
    const ledger = ro.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    const noDoc = ro.routes.find((r) => r.routeId === 'NO_DOCUMENT_BY_LAW')!;
    for (const route of [ledger, noDoc]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/LEDGER_ANNOTATION|TREBUIE SĂ EMITĂ/);
      }
    }
    if (ledger.provenance.kind === 'unverified') {
      expect(ledger.provenance.resolutionNote).not.toMatch(/^forbidden$/);
    }
  });

  it('the file-level notes documents the four primary sources read (Codul fiscal, OUG 120/2021, Legea 296/2023, OUG 115/2023, OUG 69/2024) and the deliberate absence of B2G modeling', () => {
    expect(ro.notes ?? '').toMatch(/Legea nr\. 227\/2015/);
    expect(ro.notes ?? '').toMatch(/OUG_120_2021|Ordonanţa de urgenţă a Guvernului nr\. 120\/2021/);
    expect(ro.notes ?? '').toMatch(/Legea nr\. 296\/2023/);
    expect(ro.notes ?? '').toMatch(/Ordonanţa de urgenţă a Guvernului nr\. 115\/2023/);
    expect(ro.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
  });
});
