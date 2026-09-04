/**
 * NL — direct-load content spec, added by the NL country agent (TODO_DOCUMENTS.md, vague B, lot 1).
 * Same rationale as country-policy/data/nl.spec.ts: reads `nl.json` straight off disk rather than
 * through `data/all.ts` (still FR only — wiring "nl" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadNl(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'nl.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('NL — vat-rates/data/nl.json', () => {
  const nl = loadNl();

  it('declares countryCode NL with exactly three rates — 21 / 9 / 0 — every one "legal"', () => {
    expect(nl.countryCode).toBe('NL');
    const rates = nl.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 9, 21]);
    for (const rate of nl.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of nl.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'nl.json (test)')).not.toThrow();
    }
  });

  it('pins each rate to its own Wet op de omzetbelasting 1968 art. 9 sub-provision, by id — never one generic citation reused three times', () => {
    const byId = (id: string) => nl.rates.find((r) => r.id === id);
    expect(byId('nl-standard')?.category).toBe('STANDARD');
    expect(byId('nl-standard')?.provenance).toMatchObject({ kind: 'legal' });
    const standard = byId('nl-standard')!;
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toBe('De belasting bedraagt 21 percent.');
    }

    const reduced = byId('nl-reduced')!;
    expect(reduced.category).toBe('REDUCED');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/9 percent/);
    }

    const zero = byId('nl-zero')!;
    expect(zero.category).toBe('ZERO');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/nihil/);
    }

    // The three citations must be genuinely distinct sub-provisions, not the same text three times.
    const texts = [standard, reduced, zero].map((r) =>
      r.provenance.kind === 'legal' ? r.provenance.sourceText : '',
    );
    expect(new Set(texts).size).toBe(3);
  });

  it('every rate id is unique', () => {
    const ids = nl.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
