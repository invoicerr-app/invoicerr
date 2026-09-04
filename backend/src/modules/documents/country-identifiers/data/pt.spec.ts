/**
 * PT — direct-load content spec, added by the PT country agent (TODO_DOCUMENTS.md, vague B, lot 7,
 * dernier lot). Same rationale as country-identifiers/data/hr.spec.ts: reads `pt.json` straight off
 * disk rather than through `data/all.ts` (wiring "pt" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadPt(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'pt.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('PT — country-identifiers/data/pt.json', () => {
  const pt = loadPt();

  it('declares countryCode PT with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(pt.countryCode).toBe('PT');
    const schemes = pt.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of pt.schemes) {
      expect(() => assertValidProvenance(fact, 'pt.json (test)')).not.toThrow();
    }
  });

  it('LEGAL_ID (NIF/NIPC) is BOTH party types, REQUIRED, sourced to CIVA art. 36.º n.º 5 alínea a) — a frontal clause for the seller, with the buyer-side nuance documented honestly', () => {
    const legalId = pt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toBe(
        'Os nomes, firmas ou denominações sociais e a sede ou domicílio do fornecedor de bens ou prestador de serviços e do destinatário ou adquirente sujeito passivo do imposto, bem como os correspondentes números de identificação fiscal;',
      );
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(legalId.notes).toMatch(/n\.º 16/);
    expect(legalId.notes).toMatch(/sempre obrigatória quando este o solicite/);
  });

  it('LEGAL_ID declares NO pattern — the 9-digit format was not confirmed against a primary text in this pass, and this is documented honestly rather than filled in from general knowledge', () => {
    const legalId = pt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.pattern).toBeUndefined();
    expect(legalId.notes).toMatch(/NON CONFIRMÉ/);
    expect(legalId.notes).toMatch(/Decreto-Lei n\.º 463\/79/);
  });

  it('VAT is BOTH party types, NOT required (the 15,000 EUR franchise threshold), sourced to CIVA art. 53.º n.º 1', () => {
    const vat = pt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toBe(
        'Beneficiam da isenção do imposto os sujeitos passivos com sede ou domicílio em território nacional que, não praticando operações de exportação ou atividades conexas, não tenham atingido, no ano civil anterior, um volume de negócios anual em território nacional superior a 15 000 €.',
      );
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('VAT also declares NO pattern — the PT+NIF equivalence is documented as an unsourced convention, never smuggled in as a legal fact', () => {
    const vat = pt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.pattern).toBeUndefined();
    expect(vat.notes).toMatch(/INFÉRENCE non sourcée/);
  });

  it('LEGAL_ID and VAT genuinely differ in required/provenance — not one copied onto the other with only labels swapped', () => {
    const legalId = pt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = pt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    if (legalId.provenance.kind === 'legal' && vat.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).not.toBe(vat.provenance.sourceText);
    }
  });

  it('the file-level notes documents the deliberate absence of a sourced pattern for either scheme and what would settle it', () => {
    expect(pt.notes ?? '').toMatch(/Decreto-Lei n\.º 463\/79/);
    expect(pt.notes ?? '').toMatch(/diariodarepublica\.pt/);
  });
});
