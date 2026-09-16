import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { BillingCustomerClient } from './billing-customer';
import { reconcileMissingCompanyCustomers } from './customer-provisioning';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findMany: jest.fn() } },
}));

jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const findMany = prisma.company.findMany as jest.Mock;
const warn = logger.warn as jest.Mock;

function notFoundError(): Error {
  return Object.assign(new Error('ResourceNotFound'), { statusCode: 404 });
}

function emailTakenError(): Error {
  return Object.assign(new Error('HTTPValidationError'), {
    statusCode: 422,
    detail: [
      { loc: ['body', 'email'], msg: 'A customer with this email address already exists.', type: 'x' },
    ],
  });
}

function fakeClient(overrides: Partial<BillingCustomerClient> = {}): BillingCustomerClient {
  return {
    customers: { getExternal: jest.fn(), create: jest.fn() },
    ...overrides,
  } as unknown as BillingCustomerClient;
}

const COMPANY_A = { id: 'company-a', name: 'Acme', email: 'a@acme.test', billingEmail: null };
const COMPANY_B = { id: 'company-b', name: 'Beta', email: 'b@beta.test', billingEmail: null };
const COMPANY_NO_EMAIL = { id: 'company-c', name: 'Ghost Test Co', email: '', billingEmail: null };

describe('reconcileMissingCompanyCustomers', () => {
  afterEach(() => jest.resetAllMocks());

  it('counts an existing company-scoped customer as alreadyExisted and never creates one', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_a', type: 'individual' });
    const create = jest.fn();
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 1,
      created: 0,
      emailTaken: 0,
      skipped: 0,
      failed: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a customer for a company that has none yet', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockRejectedValue(notFoundError());
    const create = jest.fn().mockResolvedValue({ id: 'cus_new', type: 'individual' });
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 0,
      created: 1,
      emailTaken: 0,
      skipped: 0,
      failed: 0,
    });
    expect(create).toHaveBeenCalledWith({
      type: 'individual',
      externalId: 'company-a',
      email: 'a@acme.test',
      name: 'Acme',
    });
  });

  it('counts a duplicate-billing-email refusal as emailTaken, never retried as a generic failure', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockRejectedValue(notFoundError());
    const create = jest.fn().mockRejectedValue(emailTakenError());
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 0,
      created: 0,
      emailTaken: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it('counts any other creation failure as failed, never throwing out of the pass', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockRejectedValue(notFoundError());
    const create = jest.fn().mockRejectedValue(new Error('polar is down'));
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 0,
      created: 0,
      emailTaken: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it('counts an existence-check outage as failed, without attempting to create (avoids a possible duplicate)', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockRejectedValue(new Error('polar is down'));
    const create = jest.fn();
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 0,
      created: 0,
      emailTaken: 0,
      skipped: 0,
      failed: 1,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('processes every company independently — one failure never sinks the others', async () => {
    findMany.mockResolvedValue([COMPANY_A, COMPANY_B]);
    // Company A: this function's OWN existence check 404s, then `getOrCreatePolarCustomerForCompany`
    // re-checks internally (also 404s) before attempting — and failing — to create. Company B: this
    // function's own existence check finds one straight away, so nothing else is called for it.
    const getExternal = jest
      .fn()
      .mockRejectedValueOnce(notFoundError())
      .mockRejectedValueOnce(notFoundError())
      .mockResolvedValueOnce({ id: 'cus_b', type: 'individual' });
    const create = jest.fn().mockRejectedValue(new Error('polar is down'));
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 2,
      alreadyExisted: 1,
      created: 0,
      emailTaken: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it('is a no-op summary when there are no companies at all', async () => {
    findMany.mockResolvedValue([]);
    const client = fakeClient();

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 0,
      alreadyExisted: 0,
      created: 0,
      emailTaken: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('classifies a company with no billing email as skipped, logs it by name, and never attempts a create', async () => {
    findMany.mockResolvedValue([COMPANY_NO_EMAIL]);
    const getExternal = jest.fn().mockRejectedValue(notFoundError());
    const create = jest.fn();
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 0,
      created: 0,
      emailTaken: 0,
      skipped: 1,
      failed: 0,
    });
    expect(create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no billing email'),
      expect.objectContaining({
        category: 'billing',
        details: { companyId: 'company-c', companyName: 'Ghost Test Co' },
      }),
    );
  });

  it('a real Polar failure (500) is counted as failed and logs the company id, HTTP status and Polar message', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockRejectedValue(notFoundError());
    const create = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('Internal Server Error'), { statusCode: 500 }));
    const client = fakeClient({ customers: { getExternal, create } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 0,
      created: 0,
      emailTaken: 0,
      skipped: 0,
      failed: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      expect.objectContaining({
        category: 'billing',
        details: { companyId: 'company-a', statusCode: 500, message: 'Internal Server Error' },
      }),
    );
  });
});
