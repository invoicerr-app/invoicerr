/**
 * SI — direct-load content spec, added by the SI country agent (TODO_DOCUMENTS.md, vague B, lot 7,
 * dernier lot). Same rationale as country-identifiers/data/hr.spec.ts: reads `si.json` straight off
 * disk rather than through `data/all.ts` (wiring "si" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadSi(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'si.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('SI — country-identifiers/data/si.json', () => {
  const si = loadSi();

  it('declares countryCode SI with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(si.countryCode).toBe('SI');
    const schemes = si.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of si.schemes) {
      expect(() => assertValidProvenance(fact, 'si.json (test)')).not.toThrow();
    }
  });

  it('LEGAL_ID is the davčna številka: BOTH party types, REQUIRED (a frontal "on accounting documents" clause), sourced to ZDavP-2 35. člen, and deliberately carries NO pattern (digit count not confirmed by any primary text read)', () => {
    const legalId = si.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
    expect(legalId.pattern).toBeUndefined();
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toBe(
        'Na knjigovodskih listinah, ki se izstavijo kupcem blaga oziroma naročnikom storitev in drugim osebam, mora izdajatelj navesti svojo davčno številko. Davčno številko kupca izdelkov oziroma naročnika storitev pa mora navesti, če je tako določeno z zakonom o obdavčenju ali drugim zakonom.',
      );
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(legalId.notes).toMatch(/35\. člen/);
    expect(legalId.notes).toMatch(/33\. člen/);
    expect(legalId.notes).toMatch(/MANQUE HONNÊTEMENT CONSIGNÉ/);
  });

  it('VAT is "SI" + davčna številka: not required (60,000 EUR threshold), sourced to ZDDV-1 79. člen drugi odstavek, pattern left open on digit count', () => {
    const vat = si.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(false);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('SI12345678')).toBe(true); // SI + digits, any count this schema declares
    expect(regex.test('FR12345678')).toBe(false); // wrong country prefix
    expect(regex.test('SI')).toBe(false); // no digits at all
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toBe(
        'Identifikacijska številka za DDV je davčna številka s predpono SI.',
      );
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-05');
    }
    expect(vat.notes).toMatch(/60\.000 eurov/);
    expect(vat.helpText).toMatch(/SI:VAT/);
  });

  it('LEGAL_ID and VAT genuinely differ in required — not one copied onto the other with only labels swapped', () => {
    const legalId = si.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = si.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.label).not.toBe(vat.label);
  });

  it('the file-level notes documents the davčna-številka-is-also-the-VAT-number particularity, the deliberate non-modeling of the matična številka (ZGD-1 45. člen), and the format gap for TODO_DOCUMENTS', () => {
    expect(si.notes ?? '').toMatch(/MÊME nombre/);
    expect(si.notes ?? '').toMatch(/matična številka/);
    expect(si.notes ?? '').toMatch(/ZGD-1/);
    expect(si.notes ?? '').toMatch(/MANQUE CONSIGNÉ POUR TODO_DOCUMENTS/);
  });
});
