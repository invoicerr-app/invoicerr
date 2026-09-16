import { ConflictException, NotFoundException } from '@nestjs/common';

import { BillingController } from './billing.controller';
import { BillingEmailTakenError } from './billing-customer';
import { getCompanyBillingEmail, setCompanyBillingEmail } from './billing-email';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { createCheckoutSession } from './checkout-session';
import { isLegacyUserLevelSubscription } from './legacy-customer';
import { createCustomerPortalSession, PolarCustomerNotFoundError } from './portal-session';
import { reconcileFromPolarIfStale } from './status-reconcile';

jest.mock('./company-subscription.store');
jest.mock('./status-reconcile');
jest.mock('./portal-session');
jest.mock('./checkout-session');
jest.mock('./legacy-customer');
jest.mock('./billing-email');

const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const reconcile = reconcileFromPolarIfStale as jest.Mock;
const createPortalSession = createCustomerPortalSession as jest.Mock;
const startCheckoutSession = createCheckoutSession as jest.Mock;
const isLegacy = isLegacyUserLevelSubscription as jest.Mock;
const getBillingEmail = getCompanyBillingEmail as jest.Mock;
const setBillingEmail = setCompanyBillingEmail as jest.Mock;

describe('BillingController.getStatus', () => {
  afterEach(() => jest.resetAllMocks());

  it('lazily gets-or-creates the subscription for the active company, reconciles it, checks for a legacy customer, and returns the computed view', async () => {
    const stored = {
      companyId: 'company-1',
      status: 'TRIAL',
      seats: 1,
      interval: null,
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
      polarCustomerId: null,
    };
    getOrCreate.mockResolvedValue(stored);
    reconcile.mockResolvedValue(stored);
    isLegacy.mockResolvedValue(false);
    const controller = new BillingController();

    const view = await controller.getStatus('company-1');

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(reconcile).toHaveBeenCalledWith(stored);
    expect(isLegacy).toHaveBeenCalledWith(stored);
    expect(view.status).toBe('TRIAL');
    expect(view.checkoutUrl).toBe('/api/billing/checkout');
    expect(view.portalUrl).toBe('/api/billing/portal');
    expect(view.legacySubscription).toBe(false);
  });

  it("returns the reconciled row's status when Polar repaired it, and surfaces a legacy subscription", async () => {
    getOrCreate.mockResolvedValue({
      companyId: 'company-1',
      status: 'TRIAL',
      seats: 1,
      interval: null,
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
      polarCustomerId: null,
    });
    const reconciled = {
      companyId: 'company-1',
      status: 'ACTIVE',
      seats: 1,
      interval: 'YEAR',
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
      blockedAt: null,
      zipSentAt: null,
      deletionDueAt: null,
      polarCustomerId: 'cus_old_user_level',
    };
    reconcile.mockResolvedValue(reconciled);
    isLegacy.mockResolvedValue(true);
    const controller = new BillingController();

    const view = await controller.getStatus('company-1');

    expect(view.status).toBe('ACTIVE');
    expect(view.legacySubscription).toBe(true);
  });
});

describe('BillingController.startCheckout', () => {
  afterEach(() => jest.resetAllMocks());

  it('starts a checkout for the active company', async () => {
    startCheckoutSession.mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc', redirect: true });
    const controller = new BillingController();

    const result = await controller.startCheckout('company-1', {
      slug: 'monthly',
      successUrl: 'https://app/success',
      returnUrl: 'https://app/return',
    });

    expect(startCheckoutSession).toHaveBeenCalledWith({
      companyId: 'company-1',
      slug: 'monthly',
      successUrl: 'https://app/success',
      returnUrl: 'https://app/return',
    });
    expect(result).toEqual({ url: 'https://sandbox.polar.sh/checkout/abc', redirect: true });
  });

  it('refuses an unknown slug (400) before calling Polar', async () => {
    const controller = new BillingController();

    await expect(
      controller.startCheckout('company-1', {
        slug: 'weekly' as never,
        successUrl: 'https://app/success',
        returnUrl: 'https://app/return',
      }),
    ).rejects.toThrow();
    expect(startCheckoutSession).not.toHaveBeenCalled();
  });

  it('turns a BillingEmailTakenError into a named 409', async () => {
    startCheckoutSession.mockRejectedValue(new BillingEmailTakenError('billing@acme.test'));
    const controller = new BillingController();

    const error = await controller
      .startCheckout('company-1', { slug: 'monthly', successUrl: 'https://a', returnUrl: 'https://a' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'BILLING_EMAIL_TAKEN' });
  });
});

const CLICKING_USER = {
  id: 'user-1',
  email: 'owner@acme.test',
  firstname: 'Ada',
  lastname: 'Owner',
} as never;

describe('BillingController.openPortal', () => {
  afterEach(() => jest.resetAllMocks());

  it('opens a portal session for the active company, scoped to the calling user', async () => {
    createPortalSession.mockResolvedValue({ url: 'https://polar.sh/portal/abc', redirect: true });
    const controller = new BillingController();

    const result = await controller.openPortal('company-1', CLICKING_USER);

    expect(createPortalSession).toHaveBeenCalledWith(
      'company-1',
      { id: 'user-1', email: 'owner@acme.test', name: 'Ada Owner' },
      expect.any(String),
    );
    expect(result).toEqual({ url: 'https://polar.sh/portal/abc', redirect: true });
  });

  it('turns a PolarCustomerNotFoundError into a 404', async () => {
    createPortalSession.mockRejectedValue(new PolarCustomerNotFoundError('company-1'));
    const controller = new BillingController();

    await expect(controller.openPortal('company-1', CLICKING_USER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BillingController billing-email', () => {
  afterEach(() => jest.resetAllMocks());

  it('reads the billing email view', async () => {
    getBillingEmail.mockResolvedValue({ billingEmail: null, companyEmail: 'contact@acme.test' });
    const controller = new BillingController();

    const result = await controller.getBillingEmail('company-1');

    expect(getBillingEmail).toHaveBeenCalledWith('company-1');
    expect(result).toEqual({ billingEmail: null, companyEmail: 'contact@acme.test' });
  });

  it('writes the billing email override', async () => {
    setBillingEmail.mockResolvedValue({
      billingEmail: 'billing@acme.test',
      companyEmail: 'contact@acme.test',
    });
    const controller = new BillingController();

    const result = await controller.setBillingEmail('company-1', { billingEmail: 'billing@acme.test' });

    expect(setBillingEmail).toHaveBeenCalledWith('company-1', 'billing@acme.test');
    expect(result.billingEmail).toBe('billing@acme.test');
  });

  it('clears the override when billingEmail is omitted', async () => {
    setBillingEmail.mockResolvedValue({ billingEmail: null, companyEmail: 'contact@acme.test' });
    const controller = new BillingController();

    await controller.setBillingEmail('company-1', {});

    expect(setBillingEmail).toHaveBeenCalledWith('company-1', null);
  });
});
