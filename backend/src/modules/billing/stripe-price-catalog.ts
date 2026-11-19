export type PriceGrid = 'standard' | 'founder';
export type BillingInterval = 'monthly' | 'yearly';

export type GridPrices = Record<BillingInterval, string>;

export interface StripePriceCatalog {
  standard: GridPrices;
  founder: GridPrices | null;
}

export interface PriceSlot {
  grid: PriceGrid;
  interval: BillingInterval;
}

const GRIDS: readonly PriceGrid[] = ['standard', 'founder'];
const INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly'];

const PRICE_ID = /^price_\w+$/;

export function stripePriceVarName(grid: PriceGrid, interval: BillingInterval): string {
  return `STRIPE_PRICE_${grid.toUpperCase()}_${interval.toUpperCase()}`;
}

function slots(grid: PriceGrid): PriceSlot[] {
  return INTERVALS.map((interval) => ({ grid, interval }));
}

const read = (env: NodeJS.ProcessEnv, slot: PriceSlot): string =>
  (env[stripePriceVarName(slot.grid, slot.interval)] ?? '').trim();

const isFounderConfigured = (env: NodeJS.ProcessEnv): boolean =>
  slots('founder').some((slot) => read(env, slot) !== '');

export function findStripePriceCatalogProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const required = isFounderConfigured(env) ? GRIDS.flatMap(slots) : slots('standard');
  const problems: string[] = [];
  const seen = new Map<string, string>();

  for (const slot of required) {
    const name = stripePriceVarName(slot.grid, slot.interval);
    const value = read(env, slot);
    if (value === '') {
      problems.push(`${name} is not set`);
    } else if (!PRICE_ID.test(value)) {
      problems.push(`${name} is not a Stripe price id (price_...)`);
    } else if (seen.has(value)) {
      problems.push(`${name} reuses the price of ${seen.get(value)}`);
    } else {
      seen.set(value, name);
    }
  }
  return problems;
}

function readGrid(env: NodeJS.ProcessEnv, grid: PriceGrid): GridPrices {
  return {
    monthly: read(env, { grid, interval: 'monthly' }),
    yearly: read(env, { grid, interval: 'yearly' }),
  };
}

export function readStripePriceCatalog(env: NodeJS.ProcessEnv = process.env): StripePriceCatalog {
  const problems = findStripePriceCatalogProblems(env);
  if (problems.length > 0) {
    throw new Error(`[billing] Invalid Stripe price configuration:\n- ${problems.join('\n- ')}`);
  }
  return {
    standard: readGrid(env, 'standard'),
    founder: isFounderConfigured(env) ? readGrid(env, 'founder') : null,
  };
}

export function lookupStripePrice(catalog: StripePriceCatalog, priceId: string): PriceSlot | null {
  for (const grid of GRIDS) {
    const prices = catalog[grid];
    if (!prices) continue;
    for (const interval of INTERVALS) {
      if (prices[interval] === priceId) return { grid, interval };
    }
  }
  return null;
}
