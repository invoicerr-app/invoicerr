/**
 * `extractNationalLines` is the ONE choke point BOTH national (non-EN16931) format providers build a
 * line from — FA(3)/KSeF (fa3-provider.ts, Poland) and FatturaPA (fatturapa-provider.ts, Italy) — see
 * this file's own header. Same discipline as `../shared-build.spec.ts` proves for the EN 16931
 * syntaxes: a fixed, named set of keys, no spread of the raw row, so an unmapped key (e.g. the
 * invoice/quote line's own `date` — issue #145) is structurally invisible to either national payload.
 */
import { DocumentTotals } from '../../totals/compute-totals';
import { extractNationalLines } from './national-lines';

const TOTALS: DocumentTotals = {
  currency: 'EUR',
  lines: [{ index: 0, netMinor: 100_000, vatRatePercent: 20, vatMinor: 20_000, grossMinor: 120_000 }],
  netMinor: 100_000,
  vatMinor: 20_000,
  grossMinor: 120_000,
  vatBreakdown: [{ ratePercent: 20, baseMinor: 100_000, vatMinor: 20_000 }],
  warnings: [],
};

describe('extractNationalLines — the FA(3)/FatturaPA line whitelist', () => {
  it('drops an unmapped `date` key entirely — issue #145 must not leak into KSeF/FatturaPA unless deliberately mapped', () => {
    const lines = extractNationalLines(
      {
        lines: [
          {
            description: 'Consulting',
            quantity: 1,
            unit: 'day',
            unitPrice: 1000,
            vatRate: '20',
            date: '2026-05-01',
          },
        ],
      },
      TOTALS,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty('date');
    expect(Object.keys(lines[0])).toEqual([
      'index',
      'description',
      'quantity',
      'unit',
      'unitPrice',
      'netMinor',
      'vatRatePercent',
      'rawVatRate',
      'vatMinor',
      'grossMinor',
    ]);
  });

  it('still extracts every field it DOES map, on the exact same row', () => {
    const lines = extractNationalLines(
      {
        lines: [
          {
            description: 'Consulting',
            quantity: 1,
            unit: 'day',
            unitPrice: 1000,
            vatRate: '20',
            date: '2026-05-01',
          },
        ],
      },
      TOTALS,
    );

    expect(lines[0]).toMatchObject({
      description: 'Consulting',
      quantity: 1,
      unit: 'day',
      unitPrice: 1000,
      rawVatRate: '20',
    });
  });
});
