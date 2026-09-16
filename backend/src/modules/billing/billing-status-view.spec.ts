import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { addDays, BLOCKED_DAYS } from './lifecycle';
import { computeBillingStatusView } from './billing-status-view';

const NOW = new Date('2026-09-15T00:00:00.000Z');

function sub(overrides: Partial<CompanySubscription>): CompanySubscription {
  return {
    id: 'sub-1',
    companyId: 'company-1',
    status: 'TRIAL',
    trialStartedAt: NOW,
    trialEndsAt: addDays(NOW, 7),
    blockedAt: null,
    zipSentAt: null,
    deletionDueAt: null,
    polarCustomerId: null,
    polarSubscriptionId: null,
    seats: 1,
    interval: null,
    seatPaymentFailedAt: null,
    customerSyncFailedAt: null,
    lastCheckoutStartedAt: null,
    lastPolarFactAt: null,
    billingWarningMilestonesSent: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as CompanySubscription;
}

describe('computeBillingStatusView', () => {
  it('counts down to trialEndsAt while TRIAL', () => {
    const view = computeBillingStatusView(sub({ status: 'TRIAL', trialEndsAt: addDays(NOW, 3) }), NOW);
    expect(view.daysRemaining).toBe(3);
    expect(view.status).toBe('TRIAL');
  });

  it('counts down to blockedAt + 14 days while BLOCKED', () => {
    const blockedAt = addDays(NOW, -10);
    const view = computeBillingStatusView(sub({ status: 'BLOCKED', blockedAt }), NOW);
    expect(view.daysRemaining).toBe(BLOCKED_DAYS - 10);
  });

  it('counts down to deletionDueAt while ZIPPED', () => {
    const deletionDueAt = addDays(NOW, 45);
    const view = computeBillingStatusView(sub({ status: 'ZIPPED', deletionDueAt }), NOW);
    expect(view.daysRemaining).toBe(45);
  });

  it('never goes negative once a boundary has passed', () => {
    const view = computeBillingStatusView(sub({ status: 'TRIAL', trialEndsAt: addDays(NOW, -5) }), NOW);
    expect(view.daysRemaining).toBe(0);
  });

  it('is null for ACTIVE and PAST_DUE', () => {
    expect(computeBillingStatusView(sub({ status: 'ACTIVE' }), NOW).daysRemaining).toBeNull();
    expect(computeBillingStatusView(sub({ status: 'PAST_DUE' }), NOW).daysRemaining).toBeNull();
  });

  it('is null defensively when BLOCKED carries no blockedAt', () => {
    expect(
      computeBillingStatusView(sub({ status: 'BLOCKED', blockedAt: null }), NOW).daysRemaining,
    ).toBeNull();
  });

  it('always carries the checkout/portal route paths', () => {
    const view = computeBillingStatusView(sub({}), NOW);
    expect(view.checkoutUrl).toBe('/api/billing/checkout');
    expect(view.portalUrl).toBe('/api/billing/portal');
  });

  it('carries seats and interval through unchanged', () => {
    const view = computeBillingStatusView(sub({ seats: 7, interval: 'YEAR' }), NOW);
    expect(view.seats).toBe(7);
    expect(view.interval).toBe('YEAR');
  });
});

describe('computeBillingStatusView — seatPaymentFailureExplainsStatus', () => {
  it('is false by default (no seat failure recorded)', () => {
    expect(computeBillingStatusView(sub({ status: 'PAST_DUE' }), NOW).seatPaymentFailureExplainsStatus).toBe(
      false,
    );
  });

  it('is true when PAST_DUE with a recorded seat-payment failure and no newer Polar fact', () => {
    const view = computeBillingStatusView(
      sub({ status: 'PAST_DUE', seatPaymentFailedAt: addDays(NOW, -1), lastPolarFactAt: null }),
      NOW,
    );
    expect(view.seatPaymentFailureExplainsStatus).toBe(true);
  });

  it('is false for ACTIVE/TRIAL/BLOCKED/ZIPPED even with a seatPaymentFailedAt on file', () => {
    for (const status of ['ACTIVE', 'TRIAL', 'BLOCKED', 'ZIPPED'] as const) {
      expect(
        computeBillingStatusView(sub({ status, seatPaymentFailedAt: addDays(NOW, -1) }), NOW)
          .seatPaymentFailureExplainsStatus,
      ).toBe(false);
    }
  });

  it('is false once a NEWER general Polar fact has landed since the seat failure — a stale reason must not survive an unrelated, more recent cause', () => {
    const view = computeBillingStatusView(
      sub({
        status: 'PAST_DUE',
        seatPaymentFailedAt: addDays(NOW, -5),
        lastPolarFactAt: addDays(NOW, -1), // a later, unrelated fact arrived since
      }),
      NOW,
    );
    expect(view.seatPaymentFailureExplainsStatus).toBe(false);
  });

  it('is true when the seat failure is itself the MOST RECENT fact, even if lastPolarFactAt is also set (equal instant)', () => {
    const failedAt = addDays(NOW, -1);
    const view = computeBillingStatusView(
      sub({ status: 'PAST_DUE', seatPaymentFailedAt: failedAt, lastPolarFactAt: failedAt }),
      NOW,
    );
    expect(view.seatPaymentFailureExplainsStatus).toBe(true);
  });
});
