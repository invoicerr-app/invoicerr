import {
  findStripePriceCatalogProblems,
  lookupStripePrice,
  readStripePriceCatalog,
  stripePriceVarName,
} from './stripe-price-catalog';

const STANDARD_ONLY = {
  STRIPE_PRICE_STANDARD_MONTHLY: 'price_standard_m',
  STRIPE_PRICE_STANDARD_YEARLY: 'price_standard_y',
};
const BOTH_GRIDS = {
  ...STANDARD_ONLY,
  STRIPE_PRICE_FOUNDER_MONTHLY: 'price_founder_m',
  STRIPE_PRICE_FOUNDER_YEARLY: 'price_founder_y',
};

describe('stripePriceVarName', () => {
  it('names one variable per grid and interval', () => {
    expect(stripePriceVarName('founder', 'yearly')).toBe('STRIPE_PRICE_FOUNDER_YEARLY');
  });
});

describe('findStripePriceCatalogProblems', () => {
  it('accepts a complete standard grid without a founder grid', () => {
    expect(findStripePriceCatalogProblems(STANDARD_ONLY)).toEqual([]);
  });

  it('accepts both grids complete', () => {
    expect(findStripePriceCatalogProblems(BOTH_GRIDS)).toEqual([]);
  });

  it('requires both standard prices', () => {
    expect(findStripePriceCatalogProblems({})).toEqual([
      'STRIPE_PRICE_STANDARD_MONTHLY is not set',
      'STRIPE_PRICE_STANDARD_YEARLY is not set',
    ]);
  });

  it('treats a blank value as unset', () => {
    expect(findStripePriceCatalogProblems({ ...STANDARD_ONLY, STRIPE_PRICE_STANDARD_MONTHLY: '  ' })).toEqual(
      ['STRIPE_PRICE_STANDARD_MONTHLY is not set'],
    );
  });

  it('requires the whole founder grid once any founder price is set', () => {
    expect(
      findStripePriceCatalogProblems({ ...STANDARD_ONLY, STRIPE_PRICE_FOUNDER_YEARLY: 'price_f_y' }),
    ).toEqual(['STRIPE_PRICE_FOUNDER_MONTHLY is not set']);
  });

  it('rejects a value that is not a Stripe price id', () => {
    expect(
      findStripePriceCatalogProblems({ ...STANDARD_ONLY, STRIPE_PRICE_STANDARD_YEARLY: 'prod_abc' }),
    ).toEqual(['STRIPE_PRICE_STANDARD_YEARLY is not a Stripe price id (price_...)']);
  });

  it('rejects the same price id in two places, so a price always maps back to one plan', () => {
    expect(
      findStripePriceCatalogProblems({ ...BOTH_GRIDS, STRIPE_PRICE_FOUNDER_MONTHLY: 'price_standard_m' }),
    ).toEqual(['STRIPE_PRICE_FOUNDER_MONTHLY reuses the price of STRIPE_PRICE_STANDARD_MONTHLY']);
  });
});

describe('readStripePriceCatalog', () => {
  it('throws with every problem listed', () => {
    expect(() => readStripePriceCatalog({ STRIPE_PRICE_STANDARD_MONTHLY: 'oops' })).toThrow(
      /not a Stripe price id[\s\S]*STRIPE_PRICE_STANDARD_YEARLY is not set/,
    );
  });

  it('has no founder grid when none is configured', () => {
    expect(readStripePriceCatalog(STANDARD_ONLY).founder).toBeNull();
  });

  it('reads both grids, trimmed', () => {
    expect(readStripePriceCatalog({ ...BOTH_GRIDS, STRIPE_PRICE_STANDARD_MONTHLY: ' price_x ' })).toEqual({
      standard: { monthly: 'price_x', yearly: 'price_standard_y' },
      founder: { monthly: 'price_founder_m', yearly: 'price_founder_y' },
    });
  });
});

describe('lookupStripePrice', () => {
  const catalog = readStripePriceCatalog(BOTH_GRIDS);

  it('maps a configured price back to its grid and interval', () => {
    expect(lookupStripePrice(catalog, 'price_founder_y')).toEqual({ grid: 'founder', interval: 'yearly' });
    expect(lookupStripePrice(catalog, 'price_standard_m')).toEqual({ grid: 'standard', interval: 'monthly' });
  });

  it('returns null for a price this catalog does not know', () => {
    expect(lookupStripePrice(catalog, 'price_unknown')).toBeNull();
  });

  it('ignores the founder grid when it is not configured', () => {
    expect(lookupStripePrice(readStripePriceCatalog(STANDARD_ONLY), 'price_founder_m')).toBeNull();
  });
});
