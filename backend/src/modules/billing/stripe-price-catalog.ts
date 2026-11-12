export type PriceGrid = 'standard' | 'founder';
export type BillingInterval = 'monthly' | 'yearly';
export type SeatTier = 'first' | 'seats2to4' | 'seat5plus';

export type GridPrices = Record<BillingInterval, Record<SeatTier, string>>;

export interface StripePriceCatalog {
  standard: GridPrices;
  founder: GridPrices | null;
}

export interface SeatLineItem {
  price: string;
  quantity: number;
}

export interface PriceSlot {
  grid: PriceGrid;
  interval: BillingInterval;
  tier: SeatTier;
}

const GRIDS: readonly PriceGrid[] = ['standard', 'founder'];
const INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly'];

const TIERS: readonly { tier: SeatTier; suffix: string; from: number; to: number }[] = [
  { tier: 'first', suffix: 'FIRST_SEAT', from: 1, to: 1 },
  { tier: 'seats2to4', suffix: 'SEATS_2_TO_4', from: 2, to: 4 },
  { tier: 'seat5plus', suffix: 'SEAT_5_PLUS', from: 5, to: Number.POSITIVE_INFINITY },
];

const PRICE_ID = /^price_\w+$/;

export function stripePriceVarName(grid: PriceGrid, interval: BillingInterval, tier: SeatTier): string {
  const suffix = TIERS.find((t) => t.tier === tier)?.suffix;
  return `STRIPE_PRICE_${grid.toUpperCase()}_${interval.toUpperCase()}_${suffix}`;
}

function slots(grid: PriceGrid): PriceSlot[] {
  return INTERVALS.flatMap((interval) => TIERS.map(({ tier }) => ({ grid, interval, tier })));
}

const read = (env: NodeJS.ProcessEnv, slot: PriceSlot): string =>
  (env[stripePriceVarName(slot.grid, slot.interval, slot.tier)] ?? '').trim();

export function findStripePriceCatalogProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const founderConfigured = slots('founder').some((slot) => read(env, slot) !== '');
  const required = founderConfigured ? GRIDS.flatMap(slots) : slots('standard');
  const problems: string[] = [];
  const seen = new Map<string, string>();

  for (const slot of required) {
    const name = stripePriceVarName(slot.grid, slot.interval, slot.tier);
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
  const prices = { monthly: {}, yearly: {} } as GridPrices;
  for (const slot of slots(grid)) {
    prices[slot.interval][slot.tier] = read(env, slot);
  }
  return prices;
}

export function readStripePriceCatalog(env: NodeJS.ProcessEnv = process.env): StripePriceCatalog {
  const problems = findStripePriceCatalogProblems(env);
  if (problems.length > 0) {
    throw new Error(`[billing] Invalid Stripe price configuration:\n- ${problems.join('\n- ')}`);
  }
  const founderConfigured = slots('founder').some((slot) => read(env, slot) !== '');
  return {
    standard: readGrid(env, 'standard'),
    founder: founderConfigured ? readGrid(env, 'founder') : null,
  };
}

export function seatLineItems(
  catalog: StripePriceCatalog,
  grid: PriceGrid,
  interval: BillingInterval,
  seats: number,
): SeatLineItem[] {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new Error(`Seat count must be a positive whole number, got ${seats}`);
  }
  const prices = catalog[grid];
  if (!prices) {
    throw new Error(`The ${grid} price grid is not configured`);
  }
  return TIERS.map(({ tier, from, to }) => ({
    price: prices[interval][tier],
    quantity: Math.max(0, Math.min(seats, to) - from + 1),
  })).filter((item) => item.quantity > 0);
}

export function lookupStripePrice(catalog: StripePriceCatalog, priceId: string): PriceSlot | null {
  for (const grid of GRIDS) {
    const prices = catalog[grid];
    if (!prices) continue;
    for (const slot of slots(grid)) {
      if (prices[slot.interval][slot.tier] === priceId) return slot;
    }
  }
  return null;
}
