import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { BillingCustomerClient } from './billing-customer';
import { recordPolarCustomerId } from './company-subscription.store';
import { CUSTOMER_PROVISIONING_BATCH_SIZE, reconcileMissingCompanyCustomers } from './customer-provisioning';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  // `findUniqueOrThrow` is only exercised by the `type: "team"` test below — `ensureCompanyBillingMember`
  // (`member-sync.ts`) calls straight through to `billing-customer.ts#loadCompanyBillingIdentity`, which
  // reads the SAME mocked `prisma.company` this spec already narrows to `findMany` for every other test.
  default: { company: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() } },
}));

jest.mock('./company-subscription.store');

jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const findMany = prisma.company.findMany as jest.Mock;
const findUniqueOrThrow = prisma.company.findUniqueOrThrow as jest.Mock;
const warn = logger.warn as jest.Mock;
const recordCustomerId = recordPolarCustomerId as jest.Mock;

/** The WHERE this file's own query filters on — a company still missing a known Polar customer id. */
const MISSING_CUSTOMER_WHERE = { OR: [{ subscription: null }, { subscription: { polarCustomerId: null } }] };

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

/** Same runtime shape as `fakeClient` above, but ALSO carrying the `MemberResolutionClient` surface
 *  (`customers.members.*`/`members.listMembers`) — only the `type: "team"` test below needs it, for
 *  `ensureCompanyBillingMember`'s own call (`customer-provisioning.ts`'s own header on why a `team`
 *  customer discovered already-existing also ensures the company's billing member). Typed loosely
 *  (`unknown`, not `BillingCustomerClient`) since this test also asserts on the `members.*` mocks —
 *  something the narrower interface deliberately doesn't declare. */
function fakeClientWithMembers(
  getExternal: jest.Mock,
  memberGetExternal: jest.Mock,
  createExternal: jest.Mock,
) {
  return {
    customers: {
      getExternal,
      create: jest.fn(),
      members: { getExternal: memberGetExternal, createExternal, delete: jest.fn() },
    },
    members: { listMembers: jest.fn().mockResolvedValue((async function* () {})()) },
  };
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

  it('ensures the company billing member for an already-existing customer discovered as type "team"', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    findUniqueOrThrow.mockResolvedValue(COMPANY_A);
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_team', type: 'team' });
    const memberGetExternal = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const createExternal = jest.fn().mockResolvedValue({ id: 'member-billing' });
    const client = fakeClientWithMembers(getExternal, memberGetExternal, createExternal);

    const summary = await reconcileMissingCompanyCustomers(client as unknown as BillingCustomerClient);

    expect(summary.alreadyExisted).toBe(1);
    // Resolved by the company's own billing identity (no override set — falls back to `Company.email`),
    // never any particular user's — see `member-resolution.ts#resolveOrCreateCompanyBillingMemberId`'s
    // own header.
    expect(createExternal).toHaveBeenCalledWith({
      externalId: 'company-a',
      memberCreateFromCustomer: {
        email: 'a@acme.test',
        name: 'Acme',
        externalId: '__company_billing__',
        role: 'billing_manager',
      },
    });
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

  it('queries only companies without a known Polar customer id yet — never rescans a provisioned company', async () => {
    findMany.mockResolvedValue([]);

    await reconcileMissingCompanyCustomers(fakeClient());

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: MISSING_CUSTOMER_WHERE }));
  });

  it('persists the Polar customer id for an already-existing customer, so the next pass never re-checks it', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_a', type: 'individual' });
    const client = fakeClient({ customers: { getExternal, create: jest.fn() } });

    await reconcileMissingCompanyCustomers(client);

    expect(recordCustomerId).toHaveBeenCalledWith('company-a', 'cus_a');
  });

  it('persists the Polar customer id for a newly-created customer', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockRejectedValue(notFoundError());
    const create = jest.fn().mockResolvedValue({ id: 'cus_new', type: 'individual' });
    const client = fakeClient({ customers: { getExternal, create } });

    await reconcileMissingCompanyCustomers(client);

    expect(recordCustomerId).toHaveBeenCalledWith('company-a', 'cus_new');
  });

  it('never counts a company as failed just because persisting its confirmed customer id failed', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_a', type: 'individual' });
    const client = fakeClient({ customers: { getExternal, create: jest.fn() } });
    recordCustomerId.mockRejectedValue(new Error('db is down'));

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(summary).toEqual({
      total: 1,
      alreadyExisted: 1,
      created: 0,
      emailTaken: 0,
      skipped: 0,
      failed: 0,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist'),
      expect.objectContaining({
        category: 'billing',
        details: expect.objectContaining({ companyId: 'company-a' }),
      }),
    );
  });

  it('paginates: fetches a second batch by cursor once a full batch comes back, and stops once a short batch comes back', async () => {
    const fullBatch = Array.from({ length: CUSTOMER_PROVISIONING_BATCH_SIZE }, (_, i) => ({
      id: `company-${i}`,
      name: `Company ${i}`,
      email: `c${i}@test.com`,
      billingEmail: null,
    }));
    findMany.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce([COMPANY_B]);
    const getExternal = jest.fn().mockResolvedValue({ id: 'cus_x', type: 'individual' });
    const client = fakeClient({ customers: { getExternal, create: jest.fn() } });

    const summary = await reconcileMissingCompanyCustomers(client);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: MISSING_CUSTOMER_WHERE,
        cursor: { id: `company-${CUSTOMER_PROVISIONING_BATCH_SIZE - 1}` },
        skip: 1,
      }),
    );
    expect(summary.total).toBe(CUSTOMER_PROVISIONING_BATCH_SIZE + 1);
  });

  it('never issues a second query when the first batch comes back short of the batch size', async () => {
    findMany.mockResolvedValue([COMPANY_A]);
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_a', type: 'individual' }),
        create: jest.fn(),
      },
    });

    await reconcileMissingCompanyCustomers(client);

    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
