/**
 * LT — direct-load content spec, added by the LT country agent (TODO_DOCUMENTS.md, vague B, lot 3).
 * Same rationale as vat-rates/data/gr.spec.ts: reads `lt.json` straight off disk rather than through
 * `data/all.ts` (still FR/NL/AT/EE/GR — wiring "lt" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadLt(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'lt.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('LT — vat-rates/data/lt.json', () => {
  const lt = loadLt();

  it('declares countryCode LT with exactly three rates — 21 / 12 / 5 — every one "legal"', () => {
    expect(lt.countryCode).toBe('LT');
    const rates = lt.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([5, 12, 21]);
    for (const rate of lt.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of lt.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'lt.json (test)')).not.toThrow();
    }
  });

  it('pins each rate to its own PVMĮ sub-clause, by id — never one generic citation reused three times', () => {
    const byId = (id: string) => lt.rates.find((r) => r.id === id);

    const standard = byId('lt-standard')!;
    expect(standard.category).toBe('STANDARD');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe('32. Standartinis PVM tarifas – 21 procento PVM tarifas.');
    }

    const reduced = byId('lt-reduced')!;
    expect(reduced.category).toBe('REDUCED');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toBe('3. Lengvatinis 12 procentų PVM tarifas taikomas:');
    }

    const superReduced = byId('lt-super-reduced')!;
    expect(superReduced.category).toBe('SUPER_REDUCED');
    if (superReduced.provenance.kind === 'legal') {
      expect(superReduced.provenance.sourceText).toBe('4. Lengvatinis 5 procentų PVM tarifas taikomas:');
    }

    const texts = [standard, reduced, superReduced].map((r) =>
      r.provenance.kind === 'legal' ? r.provenance.sourceText : '',
    );
    expect(new Set(texts).size).toBe(3);
  });

  it("corrects the task's own initial 9% hypothesis: the file-level notes document that PVMĮ art. 19 has no 9% bracket — the real reduced rate is 12%", () => {
    expect(lt.notes ?? '').toMatch(/PAS 9 %/);
    expect(lt.notes ?? '').toMatch(/12%/);
  });

  it("cross-checks the standard rate against tax/tax-systems/data/lt.json's own TEDB reading", () => {
    expect(lt.notes ?? '').toMatch(/tax\/tax-systems\/data\/lt\.json/);
    expect(lt.notes ?? '').toMatch(/TEDB/);
  });

  it('documents that the standard rate is a two-article composition — defined at art. 2(32), applied at art. 19(1) — never a single invented citation', () => {
    const standard = lt.rates.find((r) => r.id === 'lt-standard')!;
    expect(standard.notes ?? '').toMatch(/2 straipsnio 32 dalis/);
    expect(standard.notes ?? '').toMatch(/19 straipsnio 1 dalis|19 § 1/);
  });

  it('every rate id is unique', () => {
    const ids = lt.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
