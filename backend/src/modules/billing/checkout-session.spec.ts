import prisma from '@/prisma/prisma.service';

import { loadCompanyBillingIdentity, getOrCreatePolarCustomerForCompany } from './billing-customer';
import {
  CHECKOUT_IN_PROGRESS_WINDOW_MS,
  CheckoutAlreadyInProgressError,
  CheckoutSessionClient,
  createCheckoutSession,
  resolveCheckoutProductId,
  SubscriptionAlreadyActiveError,
} from './checkout-session';
import { getOrCreateCompanySubscription } from './company-subscription.store';

jest.mock('./billing-customer', () => ({
  loadCompanyBillingIdentity: jest.fn(),
  getOrCreatePolarCustomerForCompany: jest.fn(),
}));
jest.mock('./company-subscription.store');
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUniqueOrThrow: jest.fn() },
    partyIdentifier: { findFirst: jest.fn() },
    companySubscription: { update: jest.fn() },
  },
}));

const loadIdentity = loadCompanyBillingIdentity as jest.Mock;
const getOrCreateCustomer = getOrCreatePolarCustomerForCompany as jest.Mock;
const getOrCreateSub = getOrCreateCompanySubscription as jest.Mock;
const findCompany = prisma.company.findUniqueOrThrow as jest.Mock;
const findVat = prisma.partyIdentifier.findFirst as jest.Mock;
const updateSub = prisma.companySubscription.update as jest.Mock;

function fakeClient(create = jest.fn()): CheckoutSessionClient {
  return {
    checkouts: { create },
    customers: { getExternal: jest.fn(), create: jest.fn() },
  } as unknown as CheckoutSessionClient;
}

const COMPANY_ADDRESS_ROW = {
  address: '12 rue de la Paix',
  addressLine2: null,
  postalCode: '75002',
  city: 'Paris',
  state: null,
  country: 'France',
  countryCode: 'FR',
};

describe('resolveCheckoutProductId', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('reads POLAR_PRODUCT_ID_MONTHLY/YEARLY per slug', () => {
    process.env.POLAR_PRODUCT_ID_MONTHLY = 'prod_month';
    process.env.POLAR_PRODUCT_ID_YEARLY = 'prod_year';
    expect(resolveCheckoutProductId('monthly')).toBe('prod_month');
    expect(resolveCheckoutProductId('yearly')).toBe('prod_year');
  });

  it('throws a named error when the env var is missing', () => {
    delete process.env.POLAR_PRODUCT_ID_MONTHLY;
    expect(() => resolveCheckoutProductId('monthly')).toThrow('POLAR_PRODUCT_ID_MONTHLY');
  });
});

describe('createCheckoutSession', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.POLAR_PRODUCT_ID_MONTHLY = 'prod_month';
    process.env.POLAR_PRODUCT_ID_YEARLY = 'prod_year';
    getOrCreateSub.mockResolvedValue({ status: 'TRIAL', lastCheckoutStartedAt: null });
    findCompany.mockResolvedValue(COMPANY_ADDRESS_ROW);
    findVat.mockResolvedValue({ value: 'FR12345678901' });
    updateSub.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetAllMocks();
  });

  it('ensures the company customer exists first, then opens a checkout keyed by company id, prefilled with address and VAT number', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    const create = jest.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
    const client = fakeClient(create);

    const result = await createCheckoutSession(
      {
        companyId: 'company-1',
        slug: 'monthly',
        successUrl: 'https://app/success',
        returnUrl: 'https://app/return',
      },
      client,
    );

    expect(loadIdentity).toHaveBeenCalledWith('company-1');
    expect(getOrCreateCustomer).toHaveBeenCalledWith(
      { id: 'company-1', name: 'Acme', email: 'a@acme.test', billingEmail: null },
      client,
    );
    expect(create).toHaveBeenCalledWith({
      products: ['prod_month'],
      externalCustomerId: 'company-1',
      metadata: { companyId: 'company-1' },
      successUrl: 'https://app/success',
      returnUrl: 'https://app/return',
      isBusinessCustomer: true,
      customerBillingName: 'Acme',
      customerBillingAddress: {
        line1: '12 rue de la Paix',
        line2: null,
        postalCode: '75002',
        city: 'Paris',
        state: null,
        country: 'FR',
      },
      customerTaxId: 'FR12345678901',
    });
    expect(updateSub).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      data: { lastCheckoutStartedAt: expect.any(Date) },
    });
    expect(result).toEqual({ url: 'https://sandbox.polar.sh/checkout/abc', redirect: true });
  });

  it('omits the billing address when the country cannot be resolved to a real ISO code, never fabricating one', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    findCompany.mockResolvedValue({ ...COMPANY_ADDRESS_ROW, country: 'Nowhereland', countryCode: null });
    findVat.mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
    const client = fakeClient(create);

    await createCheckoutSession(
      {
        companyId: 'company-1',
        slug: 'monthly',
        successUrl: 'https://app/success',
        returnUrl: 'https://app/return',
      },
      client,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ customerBillingAddress: null, customerTaxId: null }),
    );
  });

  it('propagates a BillingEmailTakenError from customer resolution without opening a checkout', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-2',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockRejectedValue(new Error('BillingEmailTakenError'));
    const create = jest.fn();
    const client = fakeClient(create);

    await expect(
      createCheckoutSession(
        {
          companyId: 'company-2',
          slug: 'yearly',
          successUrl: 'https://app/success',
          returnUrl: 'https://app/return',
        },
        client,
      ),
    ).rejects.toThrow('BillingEmailTakenError');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a second checkout when an ACTIVE/trialing subscription already exists (SubscriptionAlreadyActiveError)', async () => {
    getOrCreateSub.mockResolvedValue({ status: 'ACTIVE', lastCheckoutStartedAt: null });
    const create = jest.fn();
    const client = fakeClient(create);

    await expect(
      createCheckoutSession(
        {
          companyId: 'company-1',
          slug: 'monthly',
          successUrl: 'https://app/success',
          returnUrl: 'https://app/return',
        },
        client,
      ),
    ).rejects.toThrow(SubscriptionAlreadyActiveError);
    expect(create).not.toHaveBeenCalled();
    expect(loadIdentity).not.toHaveBeenCalled();
  });

  it('refuses a second checkout started within the in-progress window (CheckoutAlreadyInProgressError)', async () => {
    getOrCreateSub.mockResolvedValue({
      status: 'TRIAL',
      lastCheckoutStartedAt: new Date(Date.now() - 1000),
    });
    const create = jest.fn();
    const client = fakeClient(create);

    await expect(
      createCheckoutSession(
        {
          companyId: 'company-1',
          slug: 'monthly',
          successUrl: 'https://app/success',
          returnUrl: 'https://app/return',
        },
        client,
      ),
    ).rejects.toThrow(CheckoutAlreadyInProgressError);
    expect(create).not.toHaveBeenCalled();
  });

  it('allows a new checkout once the in-progress window has elapsed', async () => {
    getOrCreateSub.mockResolvedValue({
      status: 'TRIAL',
      lastCheckoutStartedAt: new Date(Date.now() - CHECKOUT_IN_PROGRESS_WINDOW_MS - 1000),
    });
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    const create = jest.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
    const client = fakeClient(create);

    await createCheckoutSession(
      {
        companyId: 'company-1',
        slug: 'monthly',
        successUrl: 'https://app/success',
        returnUrl: 'https://app/return',
      },
      client,
    );

    expect(create).toHaveBeenCalled();
  });
});
