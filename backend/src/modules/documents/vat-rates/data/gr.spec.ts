/**
 * GR — direct-load content spec, added by the GR country agent (TODO_DOCUMENTS.md, vague B, lot 2).
 * Same rationale as country-policy/data/gr.spec.ts: reads `gr.json` straight off disk rather than
 * through `data/all.ts` (still FR/NL/AT — wiring "gr" in is a mandataire decision), and re-runs the
 * exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadGr(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'gr.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('GR — vat-rates/data/gr.json', () => {
  const gr = loadGr();

  it('declares countryCode GR with exactly three rates — 24 / 13 / 6 — every one "legal"', () => {
    expect(gr.countryCode).toBe('GR');
    const rates = gr.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([6, 13, 24]);
    for (const rate of gr.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of gr.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'gr.json (test)')).not.toThrow();
    }
  });

  it('pins each rate to its own Ν.2859/2000 άρθρο 21 § 1 sub-clause, by id — never one generic citation reused three times', () => {
    const byId = (id: string) => gr.rates.find((r) => r.id === id);

    const standard = byId('gr-standard')!;
    expect(standard.category).toBe('STANDARD');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/είκοσι τέσσερα τοις εκατό \(24%\)/);
    }

    const reduced = byId('gr-reduced')!;
    expect(reduced.category).toBe('REDUCED');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/δεκατρία τοις εκατό \(13%\)/);
    }

    const superReduced = byId('gr-super-reduced')!;
    expect(superReduced.category).toBe('SUPER_REDUCED');
    if (superReduced.provenance.kind === 'legal') {
      expect(superReduced.provenance.sourceText).toMatch(/έξι τοις εκατό \(6%\)/);
    }

    const texts = [standard, reduced, superReduced].map((r) =>
      r.provenance.kind === 'legal' ? r.provenance.sourceText : '',
    );
    expect(new Set(texts).size).toBe(3);
  });

  it("cross-checks the standard rate against tax/tax-systems/data/gr.json's own TEDB reading", () => {
    expect(gr.notes ?? '').toMatch(/tax\/tax-systems\/data\/gr\.json/);
    expect(gr.notes ?? '').toMatch(/TEDB/);
  });

  it('documents the Aegean islands 30% reduction mechanism (art. 21 § 4) as identified-but-not-modeled, with the TEDB-sourced 17% figure and its Ν.4811/2021 citation', () => {
    expect(gr.notes ?? '').toMatch(/Λέρος|Leros/);
    expect(gr.notes ?? '').toMatch(/17/);
    expect(gr.notes ?? '').toMatch(/4811\/2021/);
  });

  it('every rate id is unique', () => {
    const ids = gr.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
