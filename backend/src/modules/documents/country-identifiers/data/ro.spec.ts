/**
 * RO — direct-load content spec, added by the RO country agent (TODO_DOCUMENTS.md, vague B, lot 7,
 * last of the lot). Same rationale as country-identifiers/data/bg.spec.ts: reads `ro.json` straight
 * off disk rather than through `data/all.ts` (wiring "ro" in is a mandataire decision), and re-runs
 * the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadRo(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'ro.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('RO — country-identifiers/data/ro.json', () => {
  const ro = loadRo();

  it('declares countryCode RO with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(ro.countryCode).toBe('RO');
    const schemes = ro.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of ro.schemes) {
      expect(() => assertValidProvenance(fact, 'ro.json (test)')).not.toThrow();
    }
  });

  it('LEGAL_ID is the CUI: BOTH party types, required, sourced to Legea 265/2022 art. 128 — a frontal "facturi" clause', () => {
    const legalId = ro.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/obligat să menţioneze pe facturi/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(legalId.notes).toMatch(/Legea nr\. 265\/2022/);
  });

  it('LEGAL_ID deliberately declares NO pattern — no digit-count clause was found in the primary texts read, and this gap is documented rather than a range being invented', () => {
    const legalId = ro.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.pattern).toBeUndefined();
    expect(legalId.notes).toMatch(/AUCUN `pattern`/);
    expect(legalId.notes).toMatch(/AUCUNE longueur fixe/);
  });

  it("LEGAL_ID's notes cross-cite Codul de procedură fiscală art. 82 for the COMPANY+INDIVIDUAL convergence and Legea 265/2022 art. 88 for PFA/individual-trader registration", () => {
    const legalId = ro.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.notes).toMatch(/Legea nr\. 207\/2015/);
    expect(legalId.notes).toMatch(/art\. 88/);
  });

  it('VAT is the CUI prefixed "RO": BOTH party types, NOT required (small-enterprise exemption), sourced to Codul fiscal art. 318 alin. (1)', () => {
    const vat = ro.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('RO12345678')).toBe(true);
    expect(regex.test('RO123')).toBe(true); // digit count deliberately unconstrained — see notes
    expect(regex.test('FR12345678')).toBe(false); // wrong country prefix
    expect(regex.test('RO')).toBe(false); // no digits at all
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/are prefixul RO/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
  });

  it('VAT\'s notes are honest that the digit count is deliberately unanchored — only the literal "RO" prefix is sourced by art. 318, not a digit range', () => {
    const vat = ro.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes).toMatch(/DÉLIBÉRÉMENT NON ANCRÉ/);
    expect(vat.notes).toMatch(/art\. 310/);
  });

  it('LEGAL_ID and VAT genuinely differ in required/label even though they share the same underlying number', () => {
    const legalId = ro.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = ro.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.label).not.toBe(vat.label);
  });

  it('file-level notes name the three primary texts read (Legea 265/2022, Legea 207/2015, Codul fiscal) served as official PDFs by static.anaf.ro, and flag legislatie.just.ro as unreachable again this session', () => {
    expect(ro.notes).toMatch(/Legea nr\. 265\/2022/);
    expect(ro.notes).toMatch(/Legea nr\. 207\/2015/);
    expect(ro.notes).toMatch(/Legea nr\. 227\/2015/);
    expect(ro.notes).toMatch(/static\.anaf\.ro/);
    expect(ro.notes).toMatch(/legislatie\.just\.ro a refusé/);
  });
});
