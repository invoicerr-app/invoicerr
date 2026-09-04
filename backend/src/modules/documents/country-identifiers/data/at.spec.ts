/**
 * Content-pinning + schema-gate spec for `data/at.json` — the AGENT PAYS AT deliverable (lot 1,
 * TODO_DOCUMENTS.md vague B). Reads `at.json` directly (no `all.ts`/`all.spec.ts` — those stay
 * mandataire-only, and `at` is not registered in `all.ts`'s own `COUNTRY_FILES` list) and re-runs
 * `assertValidProvenance` — the same gate `all.ts` would run once this file is wired in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile, IdentifierSchemeFact } from '../schema';

function loadAt(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'at.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

function schemeFor(file: CountryIdentifierRequirementsFile, scheme: string): IdentifierSchemeFact {
  const fact = file.schemes.find((s) => s.scheme === scheme);
  if (!fact) throw new Error(`No scheme "${scheme}" in data/at.json`);
  return fact;
}

describe('AT — country-identifiers/data/at.json', () => {
  const at = loadAt();

  it('declares countryCode "AT", matching its own filename', () => {
    expect(at.countryCode).toBe('AT');
  });

  it('declares only the two schemes this catalog supports — VAT and LEGAL_ID', () => {
    expect(at.schemes.map((s) => s.scheme).sort()).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every scheme passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const fact of at.schemes) {
      expect(() => assertValidProvenance(fact, 'data/at.json')).not.toThrow();
    }
  });

  it('VAT (UID-Nummer) is "legal", sourced to UStG 1994 §11 Abs. 1, pattern ATU + 8 digits', () => {
    const vat = schemeFor(at, 'VAT');
    expect(vat.provenance.kind).toBe('legal');
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.pattern).toBe('^ATU\\d{8}$');
    expect('ATU12345678').toMatch(new RegExp(vat.pattern as string));
    const sourceText = (vat.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/Umsatzsteuer-Identifikationsnummer/);
    expect(sourceText).toMatch(/10 000 Euro/);
  });

  it('LEGAL_ID (Firmenbuchnummer) is "legal", sourced to UGB §14 Abs. 1, appliesTo COMPANY', () => {
    const legalId = schemeFor(at, 'LEGAL_ID');
    expect(legalId.provenance.kind).toBe('legal');
    expect(legalId.appliesTo).toBe('COMPANY');
    const sourceText = (legalId.provenance as { sourceText: string }).sourceText;
    expect(sourceText).toMatch(/Firmenbuchnummer/);
    expect(legalId.notes).toMatch(/UGB.*§14/);
  });

  it('the file-level notes documents the negative finding on Steuernummer (not an AT invoice requirement)', () => {
    expect(at.notes ?? '').toMatch(/Steuernummer/);
  });
});
