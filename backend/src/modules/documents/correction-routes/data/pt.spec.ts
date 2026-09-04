/**
 * PT — direct-load content spec, added by the PT country agent (TODO_DOCUMENTS.md, vague B, lot 7,
 * dernier lot). Same rationale as correction-routes/data/hr.spec.ts: reads `pt.json` straight off
 * disk rather than through `data/all.ts` (wiring "pt" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidCorrectionRouteFact`) independently.
 *
 * PT has no `docs/compliance/CORRECTION-ROUTES.yaml` entry (covered: FR/IT/PL/DE/ES/MX/US only) —
 * this is the first, direct (C1) reading for this country, grounded in the Código do IVA (CIVA, as
 * served by the Autoridade Tributária e Aduaneira on info.portaldasfinancas.gov.pt, static HTML, curl
 * direct) and the Decreto-Lei n.º 28/2019 (official PDF, pdftotext -layout) — never a fetch-résumé.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidCorrectionRouteFact, CORRECTION_ROUTE_IDS, CountryCorrectionRoutesFile } from '../schema';

function loadPt(): CountryCorrectionRoutesFile {
  const raw = readFileSync(join(__dirname, 'pt.json'), 'utf-8');
  return JSON.parse(raw) as CountryCorrectionRoutesFile;
}

describe('PT — correction-routes/data/pt.json', () => {
  const pt = loadPt();

  it('declares countryCode PT and covers all eleven canonical routes exhaustively, no duplicates', () => {
    expect(pt.countryCode).toBe('PT');
    const ids = pt.routes.map((r) => r.routeId).sort();
    expect(ids).toEqual([...CORRECTION_ROUTE_IDS].sort());
    expect(new Set(ids).size).toBe(11);
  });

  it('every route passes the load-time gate (the status / provenance.kind coupling)', () => {
    for (const route of pt.routes) {
      expect(() => assertValidCorrectionRouteFact(route, 'pt.json (test)')).not.toThrow();
    }
  });

  it('CREDIT_NOTE is "allowed" and DEBIT_NOTE is "required" — the SAME CIVA art. 78.º n.º 3 alinéa splits the two directions asymmetrically, a first for this catalogue', () => {
    const credit = pt.routes.find((r) => r.routeId === 'CREDIT_NOTE')!;
    const debit = pt.routes.find((r) => r.routeId === 'DEBIT_NOTE')!;
    expect(credit.status).toBe('allowed');
    expect(debit.status).toBe('required');
    expect(credit.provenance.kind).toBe('legal');
    expect(debit.provenance.kind).toBe('legal');
    if (debit.provenance.kind === 'legal') {
      expect(debit.provenance.sourceText).toMatch(
        /a rectificação é obrigatória quando houver imposto liquidado a menos/,
      );
      expect(debit.provenance.sourceText).toMatch(/é facultativa, quando houver imposto liquidado a mais/);
      expect(debit.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('CORRECTIVE_INVOICE is "allowed", grounded in CIVA art. 36.º n.º 6 — the referencing-and-listing-changes clause for a document that amends by reference', () => {
    const route = pt.routes.find((r) => r.routeId === 'CORRECTIVE_INVOICE')!;
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toBe(
        'As guias ou notas de devolução e outros documentos retificativos de faturas devem conter, além da data e numeração sequencial, os elementos a que se refere a alínea a) do número anterior, bem como a referência à fatura a que respeitam e as menções desta que são objeto de alterações.',
      );
    }
  });

  it('LEDGER_ANNOTATION is "allowed", grounded in CIVA art. 78.º n.º 6 — correcting the VAT register/declaration itself, without any client-facing document', () => {
    const route = pt.routes.find((r) => r.routeId === 'LEDGER_ANNOTATION')!;
    expect(route.status).toBe('allowed');
    expect(route.provenance.kind).toBe('legal');
    if (route.provenance.kind === 'legal') {
      expect(route.provenance.sourceText).toMatch(/correcção de erros materiais ou de cálculo no registo/);
      expect(route.provenance.sourceText).toMatch(
        /sendo obrigatória quando resulte imposto a favor do Estado/,
      );
    }
  });

  it('the other seven routes are honestly "unverified"', () => {
    const legalIds = new Set(['CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE', 'LEDGER_ANNOTATION']);
    const rest = pt.routes.filter((r) => !legalIds.has(r.routeId));
    expect(rest.length).toBe(7);
    for (const route of rest) {
      expect(route.status).toBe('unverified');
      expect(route.provenance.kind).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote.length).toBeGreaterThan(20);
      }
    }
  });

  it("INTERNAL_CREDIT_NOTE documents the real CIVA art. 78.º n.º 5 proof-of-buyer-awareness tension, without being promoted to 'forbidden' by reasoning alone", () => {
    const route = pt.routes.find((r) => r.routeId === 'INTERNAL_CREDIT_NOTE')!;
    expect(route.status).toBe('unverified');
    if (route.provenance.kind === 'unverified') {
      expect(route.provenance.resolutionNote).toMatch(/art\. 78\.º n\.º 5/);
      expect(route.provenance.resolutionNote).toMatch(
        /jamais promu par raisonnement|não é promovida|discipline/i,
      );
    }
  });

  it('CANCEL_AND_REPLACE and AUTHORITY_ANNULMENT both document the structural absence of any real-time clearance — SAF-T (PT) is a post-hoc monthly declaration, not a per-document validation', () => {
    const cancel = pt.routes.find((r) => r.routeId === 'CANCEL_AND_REPLACE')!;
    const annulment = pt.routes.find((r) => r.routeId === 'AUTHORITY_ANNULMENT')!;
    for (const route of [cancel, annulment]) {
      expect(route.status).toBe('unverified');
      if (route.provenance.kind === 'unverified') {
        expect(route.provenance.resolutionNote).toMatch(/SAF-T \(PT\)/);
      }
    }
  });

  it('the file-level notes documents the two primary sources, the DEBIT_NOTE/CREDIT_NOTE asymmetry headline finding, and the deliberate absence of any B2G modeling', () => {
    expect(pt.notes ?? '').toMatch(/Código do IVA/);
    expect(pt.notes ?? '').toMatch(/Decreto-Lei n\.º 28\/2019/);
    expect(pt.notes ?? '').toMatch(/ASYMÉTRIQUE/);
    expect(pt.notes ?? '').toMatch(/B2G_COVERAGE\.md/);
  });
});
