/**
 * LU — direct-load content spec, added by the LU country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as vat-rates/data/ee.spec.ts: reads `lu.json` straight off disk rather than through
 * `data/all.ts` (wiring "lu" in is a mandataire decision), and re-runs the exact load-time gate
 * (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadLu(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'lu.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('LU — vat-rates/data/lu.json', () => {
  const lu = loadLu();

  it('declares countryCode LU with exactly five rates — 17 / 14 / 8 / 3 / 0 — every one "legal"', () => {
    expect(lu.countryCode).toBe('LU');
    const rates = lu.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 3, 8, 14, 17]);
    for (const rate of lu.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of lu.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'lu.json (test)')).not.toThrow();
    }
  });

  it("pins the standard rate to 17% (LTVA art. 39 §3 al. 1, as rewritten by the Loi du 19 décembre 2014 art. 6.2) — resolving to the same figure as tax-systems/data/lu.json's own TEDB source", () => {
    const standard = lu.rates.find((r) => r.id === 'lu-standard')!;
    expect(standard.category).toBe('STANDARD');
    expect(standard.provenance.kind).toBe('legal');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/dix-sept/);
      expect(standard.provenance.sourceText).toMatch(/quinze/);
    }
  });

  it('pins each non-standard rate to its own alinéa of the SAME art. 39 §3 amendment, never one generic citation reused', () => {
    const byId = (id: string) => lu.rates.find((r) => r.id === id)!;

    const intermediate = byId('lu-intermediate');
    expect(intermediate.rate).toBe(14);
    expect(intermediate.category).toBe('REDUCED');
    if (intermediate.provenance.kind === 'legal') {
      expect(intermediate.provenance.sourceText).toMatch(/quatorze/);
    }

    const reduced = byId('lu-reduced');
    expect(reduced.rate).toBe(8);
    expect(reduced.category).toBe('SUPER_REDUCED');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/huit/);
    }

    const superReduced = byId('lu-super-reduced');
    expect(superReduced.rate).toBe(3);
    expect(superReduced.category).toBe('SUPER_REDUCED');
    if (superReduced.provenance.kind === 'legal') {
      expect(superReduced.provenance.sourceText).toMatch(/taux super-réduit/);
    }

    const texts = [intermediate, reduced, superReduced].map((r) =>
      r.provenance.kind === 'legal' ? r.provenance.sourceText : '',
    );
    expect(new Set(texts).size).toBe(3);
  });

  it('"Taux réduit" (8%) is classified SUPER_REDUCED, not REDUCED — the label carries the official term, the category only a relative rank (same convention as fr.json\'s own "Taux réduit" at 5.5%)', () => {
    const reduced = lu.rates.find((r) => r.id === 'lu-reduced')!;
    const intermediate = lu.rates.find((r) => r.id === 'lu-intermediate')!;
    expect(reduced.label).toBe('Taux réduit');
    expect(reduced.category).toBe('SUPER_REDUCED');
    expect(intermediate.category).toBe('REDUCED');
    expect(intermediate.rate).toBeGreaterThan(reduced.rate);
  });

  it("models the small-business exemption (art. 57bis, 50 000 EUR threshold) as EXEMPT at 0%, not ZERO — same pattern as fr.json's own franchise en base", () => {
    const exempt = lu.rates.find((r) => r.id === 'lu-exempt-57bis')!;
    expect(exempt.rate).toBe(0);
    expect(exempt.category).toBe('EXEMPT');
    expect(exempt.provenance.kind).toBe('legal');
    if (exempt.provenance.kind === 'legal') {
      expect(exempt.provenance.sourceText).toMatch(/50 000 euros/);
      expect(exempt.provenance.sourceText).toMatch(/TVA non applicable/);
    }
  });

  it('every rate id is unique', () => {
    const ids = lu.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the file-level notes documents the legilux SPARQL-content-negotiation access method and the absence of an up-to-date LTVA consolidation', () => {
    expect(lu.notes ?? '').toMatch(/sparqlendpoint/);
    expect(lu.notes ?? '').toMatch(/consolide\/19800101/);
    expect(lu.notes ?? '').toMatch(/pfi\.public\.lu/);
  });
});
