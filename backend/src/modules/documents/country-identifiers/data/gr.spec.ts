/**
 * GR — direct-load content spec, added by the GR country agent (TODO_DOCUMENTS.md, vague B, lot 2).
 * Same rationale as country-policy/data/gr.spec.ts: reads `gr.json` straight off disk rather than
 * through `data/all.ts` (still FR/DE/GB/US/NL/AT — wiring "gr" in is a mandataire decision), and
 * re-runs the exact load-time gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryIdentifierRequirementsFile } from '../schema';

function loadGr(): CountryIdentifierRequirementsFile {
  const raw = readFileSync(join(__dirname, 'gr.json'), 'utf-8');
  return JSON.parse(raw) as CountryIdentifierRequirementsFile;
}

describe('GR — country-identifiers/data/gr.json', () => {
  const gr = loadGr();

  it('declares countryCode GR with exactly the two known schemes (LEGAL_ID, VAT)', () => {
    expect(gr.countryCode).toBe('GR');
    const schemes = gr.schemes.map((s) => s.scheme).sort();
    expect(schemes).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('every fact passes the load-time provenance gate', () => {
    for (const fact of gr.schemes) {
      expect(() => assertValidProvenance(fact, 'gr.json (test)')).not.toThrow();
    }
  });

  it('VAT is the ΑΦΜ: BOTH party types, required, 9 digits, sourced to Ν.4308/2014 άρθρο 9 § 1', () => {
    const vat = gr.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('BOTH');
    expect(vat.required).toBe(true);
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('094259216')).toBe(true); // 9 digits
    expect(regex.test('12345678')).toBe(false); // 8 — too short
    expect(regex.test('1234567890')).toBe(false); // 10 — too long
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/Αριθμό Φορολογικού Μητρώου/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it("the VAT fact's own notes cite the internally-vendored Peppol Schematron u:TinVerification checksum as the source of its pattern, not a fresh aade.gr reading", () => {
    const vat = gr.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.notes ?? '').toMatch(/u:TinVerification/);
  });

  it('the file-level notes quotes the exact checksum algorithm (weighted sum mod 11 mod 10) from the vendored PEPPOL-EN16931-UBL.sch', () => {
    expect(gr.notes ?? '').toMatch(/mod 11.*mod 10/);
    expect(gr.notes ?? '').toMatch(/PEPPOL-EN16931-UBL\.sch/);
  });

  it('LEGAL_ID (Γ.Ε.ΜΗ.) stays honestly "unverified" — the substantive law text was paywalled, not just the number format', () => {
    const legalId = gr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.provenance.kind).toBe('unverified');
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote).toMatch(/4919\/2022/);
      expect(legalId.provenance.resolutionNote).toMatch(/forin\.gr/);
    }
  });

  it('LEGAL_ID and VAT genuinely differ — not one copied onto the other with only labels swapped', () => {
    const legalId = gr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const vat = gr.schemes.find((s) => s.scheme === 'VAT')!;
    expect(legalId.required).not.toBe(vat.required);
    expect(legalId.appliesTo).not.toBe(vat.appliesTo);
  });
});
