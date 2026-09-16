import prisma from '@/prisma/prisma.service';

import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { MemberEmailSyncClient, syncPolarMemberEmailForUser } from './member-email-sync';
import * as memberResolution from './member-resolution';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { userCompany: { findMany: jest.fn() } },
}));
jest.mock('./company-subscription.store');
jest.mock('./member-resolution', () => ({
  ...jest.requireActual('./member-resolution'),
  resolveOrCreateMemberIdForUser: jest.fn(),
}));

const findMemberships = prisma.userCompany.findMany as jest.Mock;
const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const resolveOrCreate = memberResolution.resolveOrCreateMemberIdForUser as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

function notFoundError(): unknown {
  return { statusCode: 404 };
}

function fakeClient(overrides: Partial<MemberEmailSyncClient> = {}): MemberEmailSyncClient {
  return {
    customers: {
      getExternal: jest.fn().mockResolvedValue({ id: 'cus_1', type: 'team' }),
      members: {
        getExternal: jest.fn(),
        createExternal: jest.fn(),
        updateExternal: jest.fn().mockResolvedValue({ id: 'member-1' }),
        delete: jest.fn(),
      },
    },
    members: { listMembers: jest.fn() },
    ...overrides,
  } as unknown as MemberEmailSyncClient;
}

describe('syncPolarMemberEmailForUser', () => {
  beforeEach(() => {
    process.env[BILLING_FLAG_NAME] = 'true';
  });

  afterEach(() => {
    jest.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('is a no-op when billing is disabled', async () => {
    delete process.env[BILLING_FLAG_NAME];
    const client = fakeClient();

    await syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client);

    expect(findMemberships).not.toHaveBeenCalled();
  });

  it('only looks at companies where this user holds OWNER/ADMIN', async () => {
    findMemberships.mockResolvedValue([]);
    const client = fakeClient();

    await syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client);

    expect(findMemberships).toHaveBeenCalledWith({
      where: { userId: 'user-1', role: { in: ['OWNER', 'ADMIN'] } },
      select: { companyId: true },
    });
  });

  it('pushes the new email directly onto an APP-CREATED member (externalId = user.id), via updateExternal', async () => {
    findMemberships.mockResolvedValue([{ companyId: 'company-1' }]);
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    const client = fakeClient();

    await syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client);

    expect(client.customers.members.updateExternal).toHaveBeenCalledWith({
      externalId: 'company-1',
      memberExternalId: 'user-1',
      memberUpdate: { email: 'new@acme.test', name: 'Ada' },
    });
    expect(resolveOrCreate).not.toHaveBeenCalled();
  });

  it("resolves-or-CREATES a fresh member when no app-created member exists — covers Polar's own auto-created owner member, now unreachable by its OLD email", async () => {
    findMemberships.mockResolvedValue([{ companyId: 'company-1' }]);
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_1', type: 'team' }),
        members: {
          getExternal: jest.fn(),
          createExternal: jest.fn(),
          updateExternal: jest.fn().mockRejectedValue(notFoundError()),
          delete: jest.fn(),
        },
      } as unknown as MemberEmailSyncClient['customers'],
    });

    await syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client);

    expect(resolveOrCreate).toHaveBeenCalledWith(client, 'cus_1', 'company-1', {
      id: 'user-1',
      email: 'new@acme.test',
      name: 'Ada',
    });
  });

  it('is a no-op for a company that never checked out (no polarSubscriptionId)', async () => {
    findMemberships.mockResolvedValue([{ companyId: 'company-1' }]);
    getOrCreate.mockResolvedValue({ polarSubscriptionId: null });
    const client = fakeClient();

    await syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client);

    expect(client.customers.getExternal).not.toHaveBeenCalled();
  });

  it('is a no-op for a customer never promoted to team', async () => {
    findMemberships.mockResolvedValue([{ companyId: 'company-1' }]);
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_1', type: 'individual' }),
        members: {
          getExternal: jest.fn(),
          createExternal: jest.fn(),
          updateExternal: jest.fn(),
          delete: jest.fn(),
        },
      } as unknown as MemberEmailSyncClient['customers'],
    });

    await syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client);

    expect(client.customers.members.updateExternal).not.toHaveBeenCalled();
  });

  it('syncs every company this user holds OWNER/ADMIN in, independently', async () => {
    findMemberships.mockResolvedValue([{ companyId: 'company-1' }, { companyId: 'company-2' }]);
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    const client = fakeClient();

    await syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client);

    expect(client.customers.members.updateExternal).toHaveBeenCalledTimes(2);
  });

  it('never throws — a Polar failure is logged and swallowed', async () => {
    findMemberships.mockResolvedValue([{ companyId: 'company-1' }]);
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockRejectedValue(new Error('polar down')),
        members: {
          getExternal: jest.fn(),
          createExternal: jest.fn(),
          updateExternal: jest.fn(),
          delete: jest.fn(),
        },
      } as unknown as MemberEmailSyncClient['customers'],
    });

    await expect(
      syncPolarMemberEmailForUser('user-1', 'new@acme.test', 'Ada', client),
    ).resolves.toBeUndefined();
  });
});
