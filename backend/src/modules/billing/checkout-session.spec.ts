import { loadCompanyBillingIdentity, getOrCreatePolarCustomerForCompany } from './billing-customer';
import { CheckoutSessionClient, createCheckoutSession, resolveCheckoutProductId } from './checkout-session';

jest.mock('./billing-customer', () => ({
  loadCompanyBillingIdentity: jest.fn(),
  getOrCreatePolarCustomerForCompany: jest.fn(),
}));

const loadIdentity = loadCompanyBillingIdentity as jest.Mock;
const getOrCreateCustomer = getOrCreatePolarCustomerForCompany as jest.Mock;

function fakeClient(create = jest.fn()): CheckoutSessionClient {
  return {
    checkouts: { create },
    customers: { getExternal: jest.fn(), create: jest.fn() },
  } as unknown as CheckoutSessionClient;
}

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
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetAllMocks();
  });

  it('ensures the company customer exists first, then opens a checkout keyed by company id', async () => {
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
    });
    expect(result).toEqual({ url: 'https://sandbox.polar.sh/checkout/abc', redirect: true });
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
});
