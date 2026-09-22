import { computeGeneratedInvoiceLines, TimeEntryForBilling } from './generate-invoice-lines';

function entry(overrides: Partial<TimeEntryForBilling> = {}): TimeEntryForBilling {
  return {
    id: 'entry-1',
    projectName: 'Website redesign',
    durationMinutes: 60,
    description: null,
    hourlyRateMinor: null,
    projectHourlyRateMinor: null,
    ...overrides,
  };
}

describe('computeGeneratedInvoiceLines (pure)', () => {
  it('produces a line shaped EXACTLY like a hand-typed HOUR line: description/quantity/unit/unitPrice only', () => {
    const { lines } = computeGeneratedInvoiceLines(
      [entry({ projectHourlyRateMinor: 7500, description: 'Homepage layout' })],
      'EUR',
    );

    expect(lines).toEqual([
      { description: 'Website redesign — Homepage layout', quantity: 1, unit: 'hour', unitPrice: 75 },
    ]);
    // No `vatRate`/`articleId`/`discountPercent` key at all — never even an undefined placeholder.
    expect(Object.keys(lines[0]).sort()).toEqual(['description', 'quantity', 'unit', 'unitPrice']);
  });

  it("falls back to the project's own name when the entry carries no description", () => {
    const { lines } = computeGeneratedInvoiceLines(
      [entry({ description: null, projectHourlyRateMinor: 5000 })],
      'EUR',
    );
    expect(lines[0].description).toBe('Website redesign');
  });

  it('an entry description that is only whitespace is treated the same as none', () => {
    const { lines } = computeGeneratedInvoiceLines(
      [entry({ description: '   ', projectHourlyRateMinor: 5000 })],
      'EUR',
    );
    expect(lines[0].description).toBe('Website redesign');
  });

  it("the entry's OWN rate override wins over the project's default", () => {
    const { lines } = computeGeneratedInvoiceLines(
      [entry({ hourlyRateMinor: 12000, projectHourlyRateMinor: 5000 })],
      'EUR',
    );
    expect(lines[0].unitPrice).toBe(120);
  });

  it("falls back to the project's default rate when the entry has none of its own", () => {
    const { lines } = computeGeneratedInvoiceLines(
      [entry({ hourlyRateMinor: null, projectHourlyRateMinor: 8000 })],
      'EUR',
    );
    expect(lines[0].unitPrice).toBe(80);
  });

  it('reports an error, and produces NO line, for an entry with no resolvable rate at all — never a free (0-priced) line', () => {
    const { lines, errors } = computeGeneratedInvoiceLines(
      [entry({ hourlyRateMinor: null, projectHourlyRateMinor: null })],
      'EUR',
    );
    expect(lines).toEqual([]);
    expect(errors).toEqual([{ entryId: 'entry-1', message: expect.stringContaining('no hourly rate') }]);
  });

  it('converts minutes to hours, rounded to a hundredth', () => {
    const cases: [number, number][] = [
      [60, 1],
      [90, 1.5],
      [30, 0.5],
      [50, 0.83], // 50/60 = 0.8333... → 0.83, exercising the rounding boundary a mutant `Math.floor` would miss
      [1, 0.02], // 1/60 = 0.01666... → 0.02
    ];
    for (const [minutes, hours] of cases) {
      const { lines } = computeGeneratedInvoiceLines(
        [entry({ durationMinutes: minutes, projectHourlyRateMinor: 6000 })],
        'EUR',
      );
      expect(lines[0].quantity).toBe(hours);
    }
  });

  it('one line PER entry, in order — never aggregated into one merged line', () => {
    const { lines } = computeGeneratedInvoiceLines(
      [
        entry({ id: 'e1', description: 'Day 1', durationMinutes: 60, projectHourlyRateMinor: 5000 }),
        entry({ id: 'e2', description: 'Day 2', durationMinutes: 120, projectHourlyRateMinor: 5000 }),
      ],
      'EUR',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].quantity).toBe(1);
    expect(lines[1].quantity).toBe(2);
  });

  it('a mix of billable entries with and without a resolvable rate keeps the good ones and reports only the bad', () => {
    const { lines, errors } = computeGeneratedInvoiceLines(
      [
        entry({ id: 'ok', projectHourlyRateMinor: 5000 }),
        entry({ id: 'bad', hourlyRateMinor: null, projectHourlyRateMinor: null }),
      ],
      'EUR',
    );
    expect(lines).toHaveLength(1);
    expect(errors.map((e) => e.entryId)).toEqual(['bad']);
  });

  it("respects the currency's own decimals (JPY has none) when converting the rate", () => {
    const { lines } = computeGeneratedInvoiceLines([entry({ projectHourlyRateMinor: 7500 })], 'JPY');
    expect(lines[0].unitPrice).toBe(7500);
  });
});
