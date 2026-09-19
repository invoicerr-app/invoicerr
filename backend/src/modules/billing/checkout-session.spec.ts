import { vi, type Mock } from 'vitest';

import { logger } from '@/logger/logger.service';
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
import {
  getOrCreateCompanySubscription,
  releaseCheckoutWindow,
  reserveCheckoutWindow,
} from './company-subscription.store';

vi.mock('./billing-customer', () => ({
  loadCompanyBillingIdentity: vi.fn(),
  getOrCreatePolarCustomerForCompany: vi.fn(),
}));
vi.mock('./company-subscription.store');
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUniqueOrThrow: vi.fn() },
    partyIdentifier: { findFirst: vi.fn() },
  },
}));
vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const loadIdentity = loadCompanyBillingIdentity as Mock;
const getOrCreateCustomer = getOrCreatePolarCustomerForCompany as Mock;
const getOrCreateSub = getOrCreateCompanySubscription as Mock;
const reserveWindow = reserveCheckoutWindow as Mock;
const releaseWindow = releaseCheckoutWindow as Mock;
const warn = logger.warn as Mock;

/** Shape of Polar's own `HTTPValidationError` (422) — same fixture convention
 *  `customer-provisioning.spec.ts` already uses for the sibling "email already exists" case. */
function taxIdInvalidError(): Error {
  return Object.assign(new Error('HTTPValidationError'), {
    statusCode: 422,
    detail: [
      { loc: ['body', 'customer_tax_id'], msg: 'The provided tax ID is invalid.', type: 'value_error' },
    ],
  });
}
const findCompany = prisma.company.findUniqueOrThrow as Mock;
const findVat = prisma.partyIdentifier.findFirst as Mock;

function fakeClient(create = vi.fn()): CheckoutSessionClient {
  return {
    checkouts: { create },
    customers: { getExternal: vi.fn(), create: vi.fn() },
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
  exemptVat: false,
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
    reserveWindow.mockResolvedValue(new Date('2026-09-17T00:00:00.000Z'));
    releaseWindow.mockResolvedValue(undefined);
    findCompany.mockResolvedValue(COMPANY_ADDRESS_ROW);
    // A real, checksum-valid FR VAT number (SIREN 404833048 — same fixture as the live spec's own
    // proven-accepted number), never claimed to belong to a real company.
    findVat.mockResolvedValue({ value: 'FR83404833048' });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetAllMocks();
  });

  it('ensures the company customer exists first, then opens a checkout keyed by company id, prefilled with address and VAT number', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    const create = vi.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
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
      customerTaxId: 'FR83404833048',
    });
    // The atomic reservation itself is covered by `company-subscription.store.spec.ts`; this just
    // confirms `createCheckoutSession` asks for it with the documented window, and never falls back
    // to writing `lastCheckoutStartedAt` directly on success.
    expect(reserveWindow).toHaveBeenCalledWith('company-1', CHECKOUT_IN_PROGRESS_WINDOW_MS);
    expect(releaseWindow).not.toHaveBeenCalled();
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
    const create = vi.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
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
    const create = vi.fn();
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
    const create = vi.fn();
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

  it('refuses a second checkout when reserveCheckoutWindow reports the window already held (CheckoutAlreadyInProgressError)', async () => {
    reserveWindow.mockResolvedValue(null);
    const create = vi.fn();
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
    // Never even reaches Polar customer resolution — the refusal is purely local.
    expect(loadIdentity).not.toHaveBeenCalled();
  });

  it(
    'never lets two concurrent callers both pass the reservation check for the same company — the ' +
      'race this thread is about, exercised at the module boundary the atomic write lives behind',
    async () => {
      // Simulates Postgres serializing the two conditional UPDATEs on the same `company_subscription`
      // row: the first caller's `updateMany` finds the row eligible and claims it; the second, whose
      // WHERE clause is now false, gets `count: 0`. `company-subscription.store.spec.ts` proves the
      // real query does this atomically in a single statement — this proves `createCheckoutSession`
      // actually acts on that result instead of re-deriving its own (stale) read of `lastCheckoutStartedAt`.
      let claimed = false;
      reserveWindow.mockImplementation(async () => {
        if (claimed) return null;
        claimed = true;
        return new Date();
      });
      loadIdentity.mockResolvedValue({
        id: 'company-1',
        name: 'Acme',
        email: 'a@acme.test',
        billingEmail: null,
      });
      getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
      const create = vi.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
      const client = fakeClient(create);
      const params = {
        companyId: 'company-1',
        slug: 'monthly' as const,
        successUrl: 'https://app/success',
        returnUrl: 'https://app/return',
      };

      const [first, second] = await Promise.allSettled([
        createCheckoutSession(params, client),
        createCheckoutSession(params, client),
      ]);

      const outcomes = [first, second];
      const succeeded = outcomes.filter((o) => o.status === 'fulfilled');
      const refused = outcomes.filter(
        (o) => o.status === 'rejected' && (o.reason as Error) instanceof CheckoutAlreadyInProgressError,
      );
      expect(succeeded).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  it('allows a new checkout once reserveCheckoutWindow grants the window', async () => {
    reserveWindow.mockResolvedValue(new Date());
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    const create = vi.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
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

  it('releases the reservation when Polar never returns a checkout, so a genuine retry is not blocked for the rest of the window', async () => {
    const reservedAt = new Date('2026-09-17T00:00:00.000Z');
    reserveWindow.mockResolvedValue(reservedAt);
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    const create = vi.fn().mockRejectedValue(new Error('Polar is down'));
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
    ).rejects.toThrow('Polar is down');

    expect(releaseWindow).toHaveBeenCalledWith('company-1', reservedAt);
  });

  it('never sends a syntactically invalid VAT number (a bare SIREN, no country prefix) as the checkout tax id', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    findVat.mockResolvedValue({ value: '982187676' }); // a SIREN, not a VAT number
    const create = vi.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
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

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerTaxId: null }));
    expect(result.taxIdRejected).toBeUndefined();
  });

  it('never sends a tax id for an exempt (franchise-en-base) company, even with a checksum-valid VAT on file', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    findCompany.mockResolvedValue({ ...COMPANY_ADDRESS_ROW, exemptVat: true });
    const create = vi.fn().mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
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

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerTaxId: null }));
  });

  it('retries the checkout without the tax id when Polar refuses it with the named 422 (VIES-absent case), and reports taxIdRejected', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    const create = vi
      .fn()
      .mockRejectedValueOnce(taxIdInvalidError())
      .mockResolvedValueOnce({ url: 'https://sandbox.polar.sh/checkout/abc' });
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

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({ customerTaxId: 'FR83404833048' }));
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ customerTaxId: null }));
    expect(result).toEqual({
      url: 'https://sandbox.polar.sh/checkout/abc',
      redirect: true,
      taxIdRejected: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('refused'),
      expect.objectContaining({
        category: 'billing',
        details: { companyId: 'company-1' },
      }),
    );
    // Never logs the tax id VALUE itself.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('FR83404833048');
  });

  it('propagates a 422 that is NOT the tax-id refusal without retrying (no customerTaxId in the request at all)', async () => {
    loadIdentity.mockResolvedValue({
      id: 'company-2',
      name: 'Acme',
      email: 'a@acme.test',
      billingEmail: null,
    });
    getOrCreateCustomer.mockResolvedValue({ id: 'cus_1', type: 'individual' });
    findVat.mockResolvedValue(null); // no tax id sent at all, so this could never be the tax-id 422
    const otherError = Object.assign(new Error('HTTPValidationError'), {
      statusCode: 422,
      detail: [{ loc: ['body', 'email'], msg: 'A customer with this email address already exists.' }],
    });
    const create = vi.fn().mockRejectedValue(otherError);
    const client = fakeClient(create);

    await expect(
      createCheckoutSession(
        {
          companyId: 'company-2',
          slug: 'monthly',
          successUrl: 'https://app/success',
          returnUrl: 'https://app/return',
        },
        client,
      ),
    ).rejects.toThrow('HTTPValidationError');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
