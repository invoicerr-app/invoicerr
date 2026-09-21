import { vi, type Mock } from 'vitest';

import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { BillingController } from './billing.controller';
import {
  BillingEmailTakenError,
  loadCompanyBillingIdentity,
  MissingBillingEmailError,
} from './billing-customer';
import { getCompanyBillingEmail, setCompanyBillingEmail } from './billing-email';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { createCheckoutSession } from './checkout-session';
import { getCompanyCustomerFacts, hasLegacyPolarCustomer } from './legacy-customer';
import {
  BILLING_NO_COMPANY_CUSTOMER_CODE,
  createCustomerPortalSession,
  createLegacyCustomerPortalSession,
  PolarCustomerNotFoundError,
} from './portal-session';
import { reconcileFromPolarIfStale } from './status-reconcile';

vi.mock('./company-subscription.store');
vi.mock('./status-reconcile');
// Partial mock, deliberately: only `loadCompanyBillingIdentity` (the one Prisma call `openPortal` now
// makes) is faked — `BillingEmailTakenError`/`resolveBillingEmail` stay the REAL exports, same reason
// `portal-session` below is partially mocked rather than wholesale.
vi.mock('./billing-customer', async () => {
  const actual = await vi.importActual('./billing-customer');
  return { ...actual, loadCompanyBillingIdentity: vi.fn() };
});
// Partial mock, deliberately: only the two Polar-calling functions are faked — `PolarCustomerNotFoundError`
// (and its `code`) and `BILLING_NO_COMPANY_CUSTOMER_CODE` stay the REAL exports, so a fixture built with
// `new PolarCustomerNotFoundError(...)` below carries a real `.message`/`.code` the controller actually
// reads, instead of whatever an auto-mocked class constructor would (or wouldn't) leave on the instance.
vi.mock('./portal-session', async () => {
  const actual = await vi.importActual('./portal-session');
  return {
    ...actual,
    createCustomerPortalSession: vi.fn(),
    createLegacyCustomerPortalSession: vi.fn(),
  };
});
vi.mock('./checkout-session');
vi.mock('./legacy-customer');
vi.mock('./billing-email');

const loadBillingIdentity = loadCompanyBillingIdentity as Mock;
const getOrCreate = getOrCreateCompanySubscription as Mock;
const reconcile = reconcileFromPolarIfStale as Mock;
const createPortalSession = createCustomerPortalSession as Mock;
const createLegacyPortalSession = createLegacyCustomerPortalSession as Mock;
const startCheckoutSession = createCheckoutSession as Mock;
const getFacts = getCompanyCustomerFacts as Mock;
const hasLegacyCustomer = hasLegacyPolarCustomer as Mock;
const getBillingEmail = getCompanyBillingEmail as Mock;
const setBillingEmail = setCompanyBillingEmail as Mock;

const CLICKING_USER = {
  id: 'user-1',
  email: 'owner@acme.test',
  firstname: 'Ada',
  lastname: 'Owner',
} as never;

describe('BillingController.getStatus', () => {
  afterEach(() => vi.resetAllMocks());

  it('lazily gets-or-creates the subscription for the active company, reconciles it, reads the customer facts, and returns the computed view', async () => {
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
    getFacts.mockResolvedValue({ hasCompanyCustomer: false, legacySubscription: false });
    const controller = new BillingController();

    const view = await controller.getStatus('company-1', CLICKING_USER);

    expect(getOrCreate).toHaveBeenCalledWith('company-1');
    expect(reconcile).toHaveBeenCalledWith(stored);
    expect(getFacts).toHaveBeenCalledWith(stored);
    expect(hasLegacyCustomer).not.toHaveBeenCalled();
    expect(view.status).toBe('TRIAL');
    expect(view.checkoutUrl).toBe('/api/billing/checkout');
    expect(view.portalUrl).toBe('/api/billing/portal');
    expect(view.hasCompanyCustomer).toBe(false);
    expect(view.legacySubscription).toBe(false);
    expect(view.legacyPortalAvailable).toBe(false);
  });

  it("returns the reconciled row's status when Polar repaired it, and surfaces a legacy subscription with its portal availability", async () => {
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
    getFacts.mockResolvedValue({ hasCompanyCustomer: false, legacySubscription: true });
    hasLegacyCustomer.mockResolvedValue(true);
    const controller = new BillingController();

    const view = await controller.getStatus('company-1', CLICKING_USER);

    expect(view.status).toBe('ACTIVE');
    expect(view.hasCompanyCustomer).toBe(false);
    expect(view.legacySubscription).toBe(true);
    expect(hasLegacyCustomer).toHaveBeenCalledWith('user-1');
    expect(view.legacyPortalAvailable).toBe(true);
  });
});

describe('BillingController.startCheckout', () => {
  afterEach(() => vi.resetAllMocks());

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

  // The live incident this whole fix responds to: an empty billing email used to reach Polar and come
  // back as an unhandled 500. `createCheckoutSession` now refuses BEFORE that ever happens — this
  // asserts the controller turns THAT refusal into a 422 carrying the exact, actionable message
  // (`MissingBillingEmailError`'s own header on why 422 and why the message itself is the deliverable),
  // never a 409 or a generic 500.
  it('turns a MissingBillingEmailError into a named 422, carrying the exact backend message', async () => {
    startCheckoutSession.mockRejectedValue(new MissingBillingEmailError());
    const controller = new BillingController();

    const error = await controller
      .startCheckout('company-1', { slug: 'monthly', successUrl: 'https://a', returnUrl: 'https://a' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toEqual({
      message:
        'This company has no billing email address on file. Set one in Settings > Billing, then try again.',
      code: 'BILLING_EMAIL_MISSING',
    });
  });
});

describe('BillingController.openPortal', () => {
  afterEach(() => vi.resetAllMocks());

  it("opens a portal session under the COMPANY's own billing identity — never the calling user's", async () => {
    loadBillingIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme Inc',
      email: 'contact@acme.test',
      billingEmail: 'billing@acme.test',
    });
    createPortalSession.mockResolvedValue({ url: 'https://polar.sh/portal/abc', redirect: true });
    const controller = new BillingController();

    const result = await controller.openPortal('company-1');

    // The billing-email OVERRIDE wins over the plain contact email (`resolveBillingEmail`'s own
    // precedence) — and neither is `CLICKING_USER`'s own email: this route no longer reads `@User()`
    // at all, which is the fix itself (see `portal-session.ts`'s own header on the real incident).
    expect(loadBillingIdentity).toHaveBeenCalledWith('company-1');
    expect(createPortalSession).toHaveBeenCalledWith(
      'company-1',
      { email: 'billing@acme.test', name: 'Acme Inc' },
      expect.any(String),
    );
    expect(result).toEqual({ url: 'https://polar.sh/portal/abc', redirect: true });
  });

  it("falls back to the company's own contact email when no billing-email override is set", async () => {
    loadBillingIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme Inc',
      email: 'contact@acme.test',
      billingEmail: null,
    });
    createPortalSession.mockResolvedValue({ url: 'https://polar.sh/portal/abc', redirect: true });
    const controller = new BillingController();

    await controller.openPortal('company-1');

    expect(createPortalSession).toHaveBeenCalledWith(
      'company-1',
      { email: 'contact@acme.test', name: 'Acme Inc' },
      expect.any(String),
    );
  });

  it('turns a PolarCustomerNotFoundError into a named 409, not the raw message', async () => {
    loadBillingIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme Inc',
      email: 'contact@acme.test',
      billingEmail: null,
    });
    createPortalSession.mockRejectedValue(new PolarCustomerNotFoundError('company-1'));
    const controller = new BillingController();

    const error = await controller.openPortal('company-1').catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: BILLING_NO_COMPANY_CUSTOMER_CODE });
  });

  it('turns a MissingBillingEmailError into a named 422, same as startCheckout', async () => {
    loadBillingIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme Inc',
      email: 'contact@acme.test',
      billingEmail: null,
    });
    createPortalSession.mockRejectedValue(new MissingBillingEmailError());
    const controller = new BillingController();

    const error = await controller.openPortal('company-1').catch((e) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toMatchObject({ code: 'BILLING_EMAIL_MISSING' });
  });
});

describe('BillingController.openLegacyPortal', () => {
  afterEach(() => vi.resetAllMocks());

  it("opens a portal session for the calling user's own legacy customer", async () => {
    createLegacyPortalSession.mockResolvedValue({ url: 'https://polar.sh/portal/legacy', redirect: true });
    const controller = new BillingController();

    const result = await controller.openLegacyPortal(CLICKING_USER);

    expect(createLegacyPortalSession).toHaveBeenCalledWith(
      { id: 'user-1', email: 'owner@acme.test', name: 'Ada Owner' },
      expect.any(String),
    );
    expect(result).toEqual({ url: 'https://polar.sh/portal/legacy', redirect: true });
  });

  it('turns a PolarCustomerNotFoundError into a named 409', async () => {
    createLegacyPortalSession.mockRejectedValue(new PolarCustomerNotFoundError('user-1'));
    const controller = new BillingController();

    const error = await controller.openLegacyPortal(CLICKING_USER).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: BILLING_NO_COMPANY_CUSTOMER_CODE });
  });
});

describe('BillingController billing-email', () => {
  afterEach(() => vi.resetAllMocks());

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
