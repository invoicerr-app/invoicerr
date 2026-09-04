/**
 * Content-pinning + schema-gate spec for `data/cy.json` — the AGENT PAYS CY deliverable (lot 2,
 * TODO_DOCUMENTS.md vague B). Reads `cy.json` directly (no `all.ts`/`all.spec.ts` — those stay
 * mandataire-only, and `cy` is not registered in `all.ts`'s own `COUNTRY_FILES` list) and re-runs
 * `assertValidProvenance` — the same gate `all.ts` would run once this file is wired in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile, IdentifierSchemeFact } from '../schema';

function loadCy(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'cy.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

function schemeFor(file: CountryIdentifierRequirementsFile, scheme: string): IdentifierSchemeFact {
  const fact = file.schemes.find((s) => s.scheme === scheme);
  if (!fact) throw new Error(`No scheme "${scheme}" in data/cy.json`);
  return fact;
}

describe('CY — country-identifiers/data/cy.json', () => {
  const cy = loadCy();

  it('declares countryCode "CY", matching its own filename', () => {
    expect(cy.countryCode).toBe('CY');
  });

  it('declares only the two schemes this catalog supports — VAT and LEGAL_ID', () => {
    expect(cy.schemes.map((s) => s.scheme).sort()).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every scheme passes the load-time provenance gate (mirrors what data/all.ts would run)', () => {
    for (const fact of cy.schemes) {
      expect(() => assertValidProvenance(fact, 'data/cy.json')).not.toThrow();
    }
  });

  it('both schemes stay honestly "unverified" — existence is established, but not the exact format/obligation', () => {
    expect(cy.schemes.every((s) => s.provenance.kind === 'unverified')).toBe(true);
    for (const fact of cy.schemes) {
      expect(fact.required).toBe(false);
      expect(fact.pattern).toBeUndefined();
    }
  });

  it('VAT documents the gov.uk format lead (12345678X) without promoting it to "legal"', () => {
    const vat = schemeFor(cy, 'VAT');
    expect(vat.appliesTo).toBe('BOTH');
    const note = vat.provenance.kind === 'unverified' ? vat.provenance.resolutionNote : '';
    expect(note).toMatch(/gov\.uk/);
    expect(note).toMatch(/12345678X/);
    expect(note).toMatch(/9928/);
  });

  it('LEGAL_ID documents the HE (ΗΕ) company registration number and the Cap. 113 gap', () => {
    const legalId = schemeFor(cy, 'LEGAL_ID');
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.label).toMatch(/ΗΕ/);
    const note = legalId.provenance.kind === 'unverified' ? legalId.provenance.resolutionNote : '';
    expect(note).toMatch(/Cap\. 113/);
    expect(note).toMatch(/companies\.gov\.cy/);
  });

  it('the file-level notes names the Κανονισμοί (implementing Regulations) as the shared access wall', () => {
    expect(cy.notes ?? '').toMatch(/Κανονισμοί/);
    expect(cy.notes ?? '').toMatch(/mof\.gov\.cy/);
  });
});
