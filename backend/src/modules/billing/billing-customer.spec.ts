import { vi } from 'vitest';

import {
  BillingCustomerClient,
  BillingEmailTakenError,
  getOrCreatePolarCustomerForCompany,
  isResourceNotFoundError,
  resolveBillingEmail,
} from './billing-customer';

function fakeClient(overrides: Partial<BillingCustomerClient> = {}): BillingCustomerClient {
  return {
    customers: { getExternal: vi.fn(), create: vi.fn() },
    ...overrides,
  } as unknown as BillingCustomerClient;
}

function notFoundError(): Error {
  return Object.assign(new Error('ResourceNotFound'), { statusCode: 404 });
}

function emailTakenError(): Error {
  return Object.assign(new Error('HTTPValidationError'), {
    statusCode: 422,
    detail: [
      {
        loc: ['body', 'email'],
        msg: 'A customer with this email address already exists.',
        type: 'value_error',
      },
    ],
  });
}

describe('resolveBillingEmail', () => {
  it('uses the override when set and non-blank', () => {
    expect(
      resolveBillingEmail({
        id: 'c1',
        name: 'Acme',
        email: 'contact@acme.test',
        billingEmail: 'billing@acme.test',
      }),
    ).toBe('billing@acme.test');
  });

  it('falls back to the contact email when billingEmail is null', () => {
    expect(
      resolveBillingEmail({ id: 'c1', name: 'Acme', email: 'contact@acme.test', billingEmail: null }),
    ).toBe('contact@acme.test');
  });

  it('falls back to the contact email when billingEmail is blank', () => {
    expect(
      resolveBillingEmail({ id: 'c1', name: 'Acme', email: 'contact@acme.test', billingEmail: '   ' }),
    ).toBe('contact@acme.test');
  });
});

describe('isResourceNotFoundError', () => {
  it('is true for a 404-shaped error', () => {
    expect(isResourceNotFoundError(notFoundError())).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isResourceNotFoundError(new Error('boom'))).toBe(false);
    expect(isResourceNotFoundError(emailTakenError())).toBe(false);
    expect(isResourceNotFoundError(null)).toBe(false);
  });
});

describe('getOrCreatePolarCustomerForCompany', () => {
  afterEach(() => vi.resetAllMocks());

  const company = { id: 'company-1', name: 'Acme SARL', email: 'contact@acme.test', billingEmail: null };

  it('returns the existing customer when one is already registered under this company', async () => {
    const getExternal = vi.fn().mockResolvedValue({ id: 'cus_1', type: 'individual' });
    const create = vi.fn();
    const client = fakeClient({ customers: { getExternal, create } });

    const result = await getOrCreatePolarCustomerForCompany(company, client);

    expect(result).toEqual({ id: 'cus_1', type: 'individual' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a fresh individual customer, external id = company id, when none exists yet', async () => {
    const getExternal = vi.fn().mockRejectedValue(notFoundError());
    const create = vi.fn().mockResolvedValue({ id: 'cus_new', type: 'individual' });
    const client = fakeClient({ customers: { getExternal, create } });

    const result = await getOrCreatePolarCustomerForCompany(company, client);

    expect(create).toHaveBeenCalledWith({
      type: 'individual',
      externalId: 'company-1',
      email: 'contact@acme.test',
      name: 'Acme SARL',
    });
    expect(result).toEqual({ id: 'cus_new', type: 'individual' });
  });

  it('uses billingEmail over the contact email when creating', async () => {
    const getExternal = vi.fn().mockRejectedValue(notFoundError());
    const create = vi.fn().mockResolvedValue({ id: 'cus_new', type: 'individual' });
    const client = fakeClient({ customers: { getExternal, create } });

    await getOrCreatePolarCustomerForCompany({ ...company, billingEmail: 'billing@acme.test' }, client);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ email: 'billing@acme.test' }));
  });

  it('re-throws a non-404 getExternal failure without attempting to create', async () => {
    const getExternal = vi.fn().mockRejectedValue(new Error('polar is down'));
    const create = vi.fn();
    const client = fakeClient({ customers: { getExternal, create } });

    await expect(getOrCreatePolarCustomerForCompany(company, client)).rejects.toThrow('polar is down');
    expect(create).not.toHaveBeenCalled();
  });

  it('throws a named BillingEmailTakenError when Polar refuses a duplicate email', async () => {
    const getExternal = vi.fn().mockRejectedValue(notFoundError());
    const create = vi.fn().mockRejectedValue(emailTakenError());
    const client = fakeClient({ customers: { getExternal, create } });

    const error = await getOrCreatePolarCustomerForCompany(company, client).catch((e) => e);

    expect(error).toBeInstanceOf(BillingEmailTakenError);
    expect(error.code).toBe('BILLING_EMAIL_TAKEN');
    expect(error.email).toBe('contact@acme.test');
  });

  it('re-throws any other create failure unchanged', async () => {
    const getExternal = vi.fn().mockRejectedValue(notFoundError());
    const create = vi.fn().mockRejectedValue(new Error('some other Polar failure'));
    const client = fakeClient({ customers: { getExternal, create } });

    await expect(getOrCreatePolarCustomerForCompany(company, client)).rejects.toThrow(
      'some other Polar failure',
    );
  });
});
