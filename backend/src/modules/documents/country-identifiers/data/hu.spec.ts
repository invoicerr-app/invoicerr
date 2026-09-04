/**
 * HU — direct-load content spec, added by the HU-COMPLEMENT country agent (TODO_DOCUMENTS.md, vague
 * B, lot 4). Same rationale as country-identifiers/data/lu.spec.ts: reads `hu.json` straight off
 * disk rather than through `data/all.ts` (wiring "hu" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadHu(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'hu.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('HU — country-identifiers/data/hu.json', () => {
  const hu = loadHu();

  it('declares countryCode HU with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(hu.countryCode).toBe('HU');
    const schemes = hu.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of hu.schemes) {
      expect(() => assertValidProvenance(fact, 'hu.json (test)')).not.toThrow();
    }
  });

  it('VAT is the adószám: BOTH party types, required (no threshold carve-out found), 8-1-2 digit pattern, sourced to Áfa tv. 169. § c)', () => {
    const vat = hu.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(true);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('12345678-1-42')).toBe(true); // 8-1-2 digits
    expect(regex.test('1234567-1-42')).toBe(false); // 7-digit first segment — too short
    expect(regex.test('HU12345678')).toBe(false); // EU VIES form, not the domestic adószám form
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/adószáma, amely alatt a termék értékesítését/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(vat.notes).toMatch(/első nyolc számjegye/);
    expect(vat.notes).toMatch(/alanyi adómentesség/);
  });

  it('LEGAL_ID is the cégjegyzékszám: COMPANY only, required, sourced to the Ctv. 44. § (1) "az iratain fel kell tüntetnie" clause', () => {
    const legalId = hu.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(true);
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('01-09-123456')).toBe(true); // the classic Budapest Kft. cégjegyzékszám form
    expect(regex.test('123456')).toBe(false); // missing the leading two segments
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/az iratain fel kell tüntetnie/);
    }
    expect(legalId.notes).toMatch(/44\. § \(1\)/);
    expect(legalId.notes).toMatch(/egyéni vállalkozó/);
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = hu.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = hu.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
    expect(legalId.pattern).not.toBe(vat.pattern);
  });

  it('the file-level notes documents the net.jogtar.hu access-method workaround and the individual-entrepreneur registration gap', () => {
    expect(hu.notes ?? '').toMatch(/net\.jogtar\.hu/);
    expect(hu.notes ?? '').toMatch(/egyéni vállalkozó/);
  });
});
