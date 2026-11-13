import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { getOrCreateCompanySubscription } from './company-subscription.store';
import {
  companyHoldsFounderGrid,
  endsFounderGrid,
  grantFounderGrid,
  holdsFounderGrid,
  priceGridOf,
} from './founder-grid';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    companySubscription: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('./company-subscription.store', () => ({ getOrCreateCompanySubscription: vi.fn() }));

const NOW = new Date('2026-11-13T12:00:00.000Z');
const EARLIER = new Date('2026-10-01T00:00:00.000Z');

afterEach(() => vi.resetAllMocks());

describe('holding the founder grid', () => {
  it.each([
    [null, null, false, 'standard'],
    [EARLIER, null, true, 'founder'],
    [EARLIER, NOW, false, 'standard'],
  ])('granted %s, lost %s: holds %s, grid %s', (founderGrantedAt, founderLostAt, holds, grid) => {
    expect(holdsFounderGrid({ founderGrantedAt, founderLostAt })).toBe(holds);
    expect(priceGridOf({ founderGrantedAt, founderLostAt })).toBe(grid);
  });

  it('reads it from the company billing row, and a company without one does not hold it', async () => {
    (prisma.companySubscription.findUnique as Mock).mockResolvedValueOnce({
      founderGrantedAt: EARLIER,
      founderLostAt: null,
    });
    expect(await companyHoldsFounderGrid('c1')).toBe(true);
    (prisma.companySubscription.findUnique as Mock).mockResolvedValueOnce(null);
    expect(await companyHoldsFounderGrid('c2')).toBe(false);
  });
});

describe('ending the founder grid', () => {
  it.each([
    ['founder', 'canceled', true],
    ['Founder', 'canceled', true],
    ['founder', 'past_due', false],
    ['founder', 'unpaid', false],
    ['founder', 'incomplete_expired', false],
    ['founder', 'active', false],
    ['standard', 'canceled', false],
    [undefined, 'canceled', false],
  ])('plan %s, Stripe %s: ends it %s', (plan, stripeStatus, ends) => {
    expect(endsFounderGrid({ plan, stripeStatus })).toBe(ends);
  });
});

describe('grantFounderGrid', () => {
  function arrange(row: { founderGrantedAt: Date | null; founderLostAt: Date | null } | null) {
    (prisma.company.findUnique as Mock).mockResolvedValue(row ? { id: 'c1' } : null);
    (getOrCreateCompanySubscription as Mock).mockResolvedValue(row);
    (prisma.companySubscription.updateMany as Mock).mockResolvedValue({ count: 1 });
  }

  it('grants it once, stamped now', async () => {
    arrange({ founderGrantedAt: null, founderLostAt: null });
    expect(await grantFounderGrid('c1', NOW)).toBe('granted');
    expect(prisma.companySubscription.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', founderGrantedAt: null, founderLostAt: null },
      data: { founderGrantedAt: NOW },
    });
  });

  it('keeps the first grant date', async () => {
    arrange({ founderGrantedAt: EARLIER, founderLostAt: null });
    expect(await grantFounderGrid('c1', NOW)).toBe('already_held');
    expect(prisma.companySubscription.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to grant it again once lost', async () => {
    arrange({ founderGrantedAt: EARLIER, founderLostAt: EARLIER });
    expect(await grantFounderGrid('c1', NOW)).toBe('lost');
    expect(prisma.companySubscription.updateMany).not.toHaveBeenCalled();
  });

  it('reports a company that does not exist', async () => {
    arrange(null);
    expect(await grantFounderGrid('nope', NOW)).toBe('no_company');
    expect(getOrCreateCompanySubscription).not.toHaveBeenCalled();
  });
});
