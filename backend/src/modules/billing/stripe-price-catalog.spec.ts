import {
  findStripePriceCatalogProblems,
  lookupStripePrice,
  readStripePriceCatalog,
  seatLineItems,
  stripePriceVarName,
} from './stripe-price-catalog';

const grid = (prefix: string) => ({
  [`STRIPE_PRICE_${prefix}_MONTHLY_FIRST_SEAT`]: `price_${prefix.toLowerCase()}_m1`,
  [`STRIPE_PRICE_${prefix}_MONTHLY_SEATS_2_TO_4`]: `price_${prefix.toLowerCase()}_m2`,
  [`STRIPE_PRICE_${prefix}_MONTHLY_SEAT_5_PLUS`]: `price_${prefix.toLowerCase()}_m5`,
  [`STRIPE_PRICE_${prefix}_YEARLY_FIRST_SEAT`]: `price_${prefix.toLowerCase()}_y1`,
  [`STRIPE_PRICE_${prefix}_YEARLY_SEATS_2_TO_4`]: `price_${prefix.toLowerCase()}_y2`,
  [`STRIPE_PRICE_${prefix}_YEARLY_SEAT_5_PLUS`]: `price_${prefix.toLowerCase()}_y5`,
});

const STANDARD_ONLY = grid('STANDARD');
const BOTH_GRIDS = { ...STANDARD_ONLY, ...grid('FOUNDER') };

describe('stripePriceVarName', () => {
  it('names one variable per grid, interval and seat tier', () => {
    expect(stripePriceVarName('founder', 'yearly', 'seats2to4')).toBe(
      'STRIPE_PRICE_FOUNDER_YEARLY_SEATS_2_TO_4',
    );
  });
});

describe('findStripePriceCatalogProblems', () => {
  it('accepts a complete standard grid without a founder grid', () => {
    expect(findStripePriceCatalogProblems(STANDARD_ONLY)).toEqual([]);
  });

  it('accepts both grids complete', () => {
    expect(findStripePriceCatalogProblems(BOTH_GRIDS)).toEqual([]);
  });

  it('requires every standard price', () => {
    expect(findStripePriceCatalogProblems({})).toEqual(
      Object.keys(STANDARD_ONLY).map((name) => `${name} is not set`),
    );
  });

  it('treats a blank value as unset', () => {
    expect(
      findStripePriceCatalogProblems({ ...STANDARD_ONLY, STRIPE_PRICE_STANDARD_MONTHLY_FIRST_SEAT: '  ' }),
    ).toEqual(['STRIPE_PRICE_STANDARD_MONTHLY_FIRST_SEAT is not set']);
  });

  it('requires the whole founder grid once any founder price is set', () => {
    const problems = findStripePriceCatalogProblems({
      ...STANDARD_ONLY,
      STRIPE_PRICE_FOUNDER_YEARLY_FIRST_SEAT: 'price_f_y1',
    });
    expect(problems).toHaveLength(5);
    expect(problems).toContain('STRIPE_PRICE_FOUNDER_MONTHLY_FIRST_SEAT is not set');
    expect(problems).not.toContain('STRIPE_PRICE_FOUNDER_YEARLY_FIRST_SEAT is not set');
  });

  it('rejects a value that is not a Stripe price id', () => {
    expect(
      findStripePriceCatalogProblems({
        ...STANDARD_ONLY,
        STRIPE_PRICE_STANDARD_YEARLY_SEAT_5_PLUS: 'prod_abc',
      }),
    ).toEqual(['STRIPE_PRICE_STANDARD_YEARLY_SEAT_5_PLUS is not a Stripe price id (price_...)']);
  });

  it('rejects the same price id in two places, so a price always maps back to one slot', () => {
    expect(
      findStripePriceCatalogProblems({
        ...BOTH_GRIDS,
        STRIPE_PRICE_FOUNDER_MONTHLY_SEATS_2_TO_4: STANDARD_ONLY.STRIPE_PRICE_STANDARD_MONTHLY_SEATS_2_TO_4,
      }),
    ).toEqual([
      'STRIPE_PRICE_FOUNDER_MONTHLY_SEATS_2_TO_4 reuses the price of STRIPE_PRICE_STANDARD_MONTHLY_SEATS_2_TO_4',
    ]);
  });
});

describe('readStripePriceCatalog', () => {
  it('throws with every problem listed', () => {
    expect(() => readStripePriceCatalog({ STRIPE_PRICE_STANDARD_MONTHLY_FIRST_SEAT: 'oops' })).toThrow(
      /not a Stripe price id[\s\S]*STRIPE_PRICE_STANDARD_YEARLY_SEAT_5_PLUS is not set/,
    );
  });

  it('has no founder grid when none is configured', () => {
    expect(readStripePriceCatalog(STANDARD_ONLY).founder).toBeNull();
  });

  it('trims values', () => {
    const catalog = readStripePriceCatalog({
      ...STANDARD_ONLY,
      STRIPE_PRICE_STANDARD_MONTHLY_FIRST_SEAT: ' price_x ',
    });
    expect(catalog.standard.monthly.first).toBe('price_x');
  });
});

describe('seatLineItems', () => {
  const catalog = readStripePriceCatalog(BOTH_GRIDS);

  it.each([
    [1, [['price_standard_m1', 1]]],
    [
      2,
      [
        ['price_standard_m1', 1],
        ['price_standard_m2', 1],
      ],
    ],
    [
      4,
      [
        ['price_standard_m1', 1],
        ['price_standard_m2', 3],
      ],
    ],
    [
      5,
      [
        ['price_standard_m1', 1],
        ['price_standard_m2', 3],
        ['price_standard_m5', 1],
      ],
    ],
    [
      12,
      [
        ['price_standard_m1', 1],
        ['price_standard_m2', 3],
        ['price_standard_m5', 8],
      ],
    ],
  ])('splits %i seats across the tiers', (seats, expected) => {
    expect(seatLineItems(catalog, 'standard', 'monthly', seats)).toEqual(
      expected.map(([price, quantity]) => ({ price, quantity })),
    );
  });

  it('uses the requested grid and interval', () => {
    expect(seatLineItems(catalog, 'founder', 'yearly', 2)).toEqual([
      { price: 'price_founder_y1', quantity: 1 },
      { price: 'price_founder_y2', quantity: 1 },
    ]);
  });

  it('refuses the founder grid when it is not configured', () => {
    expect(() => seatLineItems(readStripePriceCatalog(STANDARD_ONLY), 'founder', 'monthly', 1)).toThrow(
      /founder price grid is not configured/,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses %p seats', (seats) => {
    expect(() => seatLineItems(catalog, 'standard', 'monthly', seats)).toThrow(/positive whole number/);
  });
});

describe('lookupStripePrice', () => {
  const catalog = readStripePriceCatalog(BOTH_GRIDS);

  it('maps a configured price back to its grid, interval and tier', () => {
    expect(lookupStripePrice(catalog, 'price_founder_m5')).toEqual({
      grid: 'founder',
      interval: 'monthly',
      tier: 'seat5plus',
    });
  });

  it('returns null for a price this catalog does not know', () => {
    expect(lookupStripePrice(catalog, 'price_unknown')).toBeNull();
  });
});
