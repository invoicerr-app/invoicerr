/**
 * LT — direct-load content spec, added by the LT country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as country-identifiers/data/gr.spec.ts: reads `lt.json` straight off disk rather
 * than through `data/all.ts` (still FR/DE/GB/US/NL/AT/EE/GR — wiring "lt" in is a mandataire
 * decision), and re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadLt(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'lt.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('LT — country-identifiers/data/lt.json', () => {
  const lt = loadLt();

  it('declares countryCode LT with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(lt.countryCode).toBe('LT');
    const schemes = lt.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of lt.schemes) {
      expect(() => assertValidProvenance(fact, 'lt.json (test)')).not.toThrow();
    }
  });

  it('VAT is the PVM mokėtojo kodas: BOTH party types, required, sourced to PVMĮ 80 straipsnio 1 dalies 3-4 punktai — no invented digit pattern', () => {
    const vat = lt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(true);
    expect(vat.pattern).toBeUndefined();
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/PVM mokėtojo kodas/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it("VAT's own notes are honest that the LT+9/12-digit format is an EU/Peppol convention, never verified against Lithuanian primary law this session", () => {
    const vat = lt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes ?? '').toMatch(/DÉLIBÉRÉMENT NON DÉCLARÉ/);
    expect(vat.notes ?? '').toMatch(/jamais promue ici par raisonnement|jamais promue par raisonnement/);
  });

  it('LEGAL_ID (juridinio asmens kodas) is "legal" and required, sourced to Civilinis kodeksas art. 2.44(1) — the exact lead the mandataire suggested', () => {
    const legalId = lt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(true);
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/juridinio asmens kodas/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('the headline finding is documented at file level: PVMĮ never mentions juridinio asmens kodas — it is the Civil Code, not the VAT law, that grounds LEGAL_ID', () => {
    expect(lt.notes ?? '').toMatch(/Civilinis kodeksas/);
    expect(lt.notes ?? '').toMatch(/NE MENTIONNE À AUCUN MOMENT/);
  });

  it('LEGAL_ID and VAT genuinely differ in scope — not one copied onto the other with only labels swapped', () => {
    const legalId = lt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = lt.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
    expect(legalId.provenance.kind === 'legal' && vat.provenance.kind === 'legal').toBe(true);
    if (legalId.provenance.kind === 'legal' && vat.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).not.toBe(vat.provenance.sourceText);
    }
  });
});
