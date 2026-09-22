import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { CompanyCustomerFacts } from './legacy-customer';
import { addDays, BLOCKED_DAYS } from './lifecycle';
import { computeBillingStatusView } from './billing-status-view';

const NOW = new Date('2026-09-15T00:00:00.000Z');

const DEFAULT_FACTS: CompanyCustomerFacts = { hasCompanyCustomer: true, legacySubscription: false };

/** Thin wrapper so most of this file's existing calls, which never cared about the two Polar-derived
 *  facts, don't have to spell out `DEFAULT_FACTS` every time. */
function computeView(sub: CompanySubscription, now: Date = NOW, facts: CompanyCustomerFacts = DEFAULT_FACTS) {
  return computeBillingStatusView(sub, facts, now);
}

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
    currentPeriodEnd: null,
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
    const view = computeView(sub({ status: 'TRIAL', trialEndsAt: addDays(NOW, 3) }), NOW);
    expect(view.daysRemaining).toBe(3);
    expect(view.status).toBe('TRIAL');
  });

  it('counts down to blockedAt + 14 days while BLOCKED', () => {
    const blockedAt = addDays(NOW, -10);
    const view = computeView(sub({ status: 'BLOCKED', blockedAt }), NOW);
    expect(view.daysRemaining).toBe(BLOCKED_DAYS - 10);
  });

  it('counts down to deletionDueAt while ZIPPED', () => {
    const deletionDueAt = addDays(NOW, 45);
    const view = computeView(sub({ status: 'ZIPPED', deletionDueAt }), NOW);
    expect(view.daysRemaining).toBe(45);
  });

  it('never goes negative once a boundary has passed', () => {
    const view = computeView(sub({ status: 'TRIAL', trialEndsAt: addDays(NOW, -5) }), NOW);
    expect(view.daysRemaining).toBe(0);
  });

  it('is null for ACTIVE', () => {
    expect(computeView(sub({ status: 'ACTIVE' }), NOW).daysRemaining).toBeNull();
  });

  it(
    'is 0, never null, for PAST_DUE with no paid period left — it folds into BLOCKED on the very next ' +
      'sweep tick, so `null` would wrongly read as "nothing urgent" an hour before the company is ' +
      'locked out',
    () => {
      expect(computeView(sub({ status: 'PAST_DUE', currentPeriodEnd: null }), NOW).daysRemaining).toBe(0);
      expect(
        computeView(sub({ status: 'PAST_DUE', currentPeriodEnd: addDays(NOW, -2) }), NOW).daysRemaining,
      ).toBe(0);
    },
  );

  it('counts down to the end of the period already paid for while PAST_DUE — the date the sweep will block on', () => {
    // Renewal refused on the 3rd, October paid for through the 31st: the screen owes this company the
    // real deadline it has to fix its card, not "0 days".
    const view = computeView(
      sub({ status: 'PAST_DUE', currentPeriodEnd: new Date('2026-10-31T06:00:00.000Z') }),
      new Date('2026-10-03T08:00:00.000Z'),
    );

    expect(view.daysRemaining).toBe(29);
  });

  it('is null defensively when BLOCKED carries no blockedAt', () => {
    expect(computeView(sub({ status: 'BLOCKED', blockedAt: null }), NOW).daysRemaining).toBeNull();
  });

  it('always carries the checkout/portal route paths', () => {
    const view = computeView(sub({}), NOW);
    expect(view.checkoutUrl).toBe('/api/billing/checkout');
    expect(view.portalUrl).toBe('/api/billing/portal');
  });

  it('carries seats and interval through unchanged', () => {
    const view = computeView(sub({ seats: 7, interval: 'YEAR' }), NOW);
    expect(view.seats).toBe(7);
    expect(view.interval).toBe('YEAR');
  });
});

describe('computeBillingStatusView — seatPaymentFailureExplainsStatus', () => {
  it('is false by default (no seat failure recorded)', () => {
    expect(computeView(sub({ status: 'PAST_DUE' }), NOW).seatPaymentFailureExplainsStatus).toBe(false);
  });

  it('is true when PAST_DUE with a recorded seat-payment failure and no newer Polar fact', () => {
    const view = computeView(
      sub({ status: 'PAST_DUE', seatPaymentFailedAt: addDays(NOW, -1), lastPolarFactAt: null }),
      NOW,
    );
    expect(view.seatPaymentFailureExplainsStatus).toBe(true);
  });

  it('is false for ACTIVE/TRIAL/BLOCKED/ZIPPED even with a seatPaymentFailedAt on file', () => {
    for (const status of ['ACTIVE', 'TRIAL', 'BLOCKED', 'ZIPPED'] as const) {
      expect(
        computeView(sub({ status, seatPaymentFailedAt: addDays(NOW, -1) }), NOW)
          .seatPaymentFailureExplainsStatus,
      ).toBe(false);
    }
  });

  it('is false once a NEWER general Polar fact has landed since the seat failure — a stale reason must not survive an unrelated, more recent cause', () => {
    const view = computeView(
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
    const view = computeView(
      sub({ status: 'PAST_DUE', seatPaymentFailedAt: failedAt, lastPolarFactAt: failedAt }),
      NOW,
    );
    expect(view.seatPaymentFailureExplainsStatus).toBe(true);
  });
});

describe('computeBillingStatusView — hasCompanyCustomer / legacySubscription', () => {
  it('carries both facts straight through, unchanged', () => {
    const view = computeView(sub({}), NOW, { hasCompanyCustomer: true, legacySubscription: false });
    expect(view.hasCompanyCustomer).toBe(true);
    expect(view.legacySubscription).toBe(false);
  });

  it('carries the legacy case through: a customer exists but points at the old, per-user one', () => {
    const view = computeView(sub({ status: 'ACTIVE' }), NOW, {
      hasCompanyCustomer: false,
      legacySubscription: true,
    });
    expect(view.hasCompanyCustomer).toBe(false);
    expect(view.legacySubscription).toBe(true);
  });
});
