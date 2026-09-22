import { vi, type Mock } from 'vitest';

import { findCompanySubscription } from '@/modules/billing/company-subscription.store';
import { CompanySubscription } from '../../prisma/generated/prisma/client';

import { currentReleasePublishedAt } from './legal-release-lookup';
import { filterPendingSlugsAfterPaidPeriodGrace } from './terms-paid-period-exemption';

vi.mock('@/modules/billing/company-subscription.store');
vi.mock('./legal-release-lookup');

const findSub = findCompanySubscription as Mock;
const releasePublishedAt = currentReleasePublishedAt as Mock;

/** A change published 2026-09-20 — the calendar floor this produces is 2026-10-01, the same fixture
 *  `modules/billing/paid-period-grace.spec.ts` uses. */
const PUBLISHED_AT = new Date('2026-09-20T00:00:00.000Z');

function activeSub(currentPeriodEnd: Date | null): CompanySubscription {
  return { status: 'ACTIVE', currentPeriodEnd } as CompanySubscription;
}

describe('filterPendingSlugsAfterPaidPeriodGrace', () => {
  afterEach(() => vi.resetAllMocks());

  it('leaves every pending slug untouched when terms-of-service is not among them — never runs a query at all', async () => {
    const result = await filterPendingSlugsAfterPaidPeriodGrace(['privacy-policy'], 'company-1');

    expect(result).toEqual(['privacy-policy']);
    expect(findSub).not.toHaveBeenCalled();
  });

  it('does not excuse terms-of-service with no active company on the request — nothing to protect', async () => {
    const result = await filterPendingSlugsAfterPaidPeriodGrace(['terms-of-service'], null);

    expect(result).toEqual(['terms-of-service']);
    expect(findSub).not.toHaveBeenCalled();
  });

  it('does not excuse terms-of-service for a Company with no subscription row at all', async () => {
    findSub.mockResolvedValue(null);

    const result = await filterPendingSlugsAfterPaidPeriodGrace(['terms-of-service'], 'company-1');

    expect(result).toEqual(['terms-of-service']);
  });

  it('does not excuse terms-of-service when no release timestamp is on file yet (defensive fallback)', async () => {
    findSub.mockResolvedValue(activeSub(new Date('2026-12-01T00:00:00.000Z')));
    releasePublishedAt.mockResolvedValue(null);

    const result = await filterPendingSlugsAfterPaidPeriodGrace(
      ['terms-of-service'],
      'company-1',
      PUBLISHED_AT,
    );

    expect(result).toEqual(['terms-of-service']);
  });

  it('excuses ONLY terms-of-service — a co-pending privacy-policy still blocks — while inside the paid-period grace', async () => {
    findSub.mockResolvedValue(activeSub(new Date('2026-10-18T00:00:00.000Z')));
    releasePublishedAt.mockResolvedValue(PUBLISHED_AT);

    const result = await filterPendingSlugsAfterPaidPeriodGrace(
      ['terms-of-service', 'privacy-policy'],
      'company-1',
      PUBLISHED_AT,
    );

    expect(result).toEqual(['privacy-policy']);
  });

  it('excuses terms-of-service alone down to an empty (fully-writable) result', async () => {
    findSub.mockResolvedValue(activeSub(new Date('2026-10-18T00:00:00.000Z')));
    releasePublishedAt.mockResolvedValue(PUBLISHED_AT);

    const result = await filterPendingSlugsAfterPaidPeriodGrace(
      ['terms-of-service'],
      'company-1',
      PUBLISHED_AT,
    );

    expect(result).toEqual([]);
  });

  it('stops excusing once the paid-period binding date has passed', async () => {
    const currentPeriodEnd = new Date('2026-10-18T00:00:00.000Z');
    findSub.mockResolvedValue(activeSub(currentPeriodEnd));
    releasePublishedAt.mockResolvedValue(PUBLISHED_AT);

    const result = await filterPendingSlugsAfterPaidPeriodGrace(
      ['terms-of-service'],
      'company-1',
      new Date(currentPeriodEnd.getTime() + 1),
    );

    expect(result).toEqual(['terms-of-service']);
  });

  it.each([
    'BLOCKED',
    'ZIPPED',
    'PAST_DUE',
    'TRIAL',
  ] as const)('never excuses a Company whose status is %s, even with a future currentPeriodEnd on file — closes the non-payment reopening path', async (status) => {
    findSub.mockResolvedValue({
      status,
      currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
    } as CompanySubscription);
    releasePublishedAt.mockResolvedValue(PUBLISHED_AT);

    const result = await filterPendingSlugsAfterPaidPeriodGrace(
      ['terms-of-service'],
      'company-1',
      PUBLISHED_AT,
    );

    expect(result).toEqual(['terms-of-service']);
  });
});
