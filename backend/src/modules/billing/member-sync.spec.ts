import prisma from '@/prisma/prisma.service';

import { BILLING_FLAG_NAME } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { MemberSyncClient, syncCompanyMemberOnMembershipChange } from './member-sync';
import * as memberResolution from './member-resolution';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { userCompany: { findUnique: jest.fn() }, user: { findUnique: jest.fn() } },
}));
jest.mock('./company-subscription.store');
jest.mock('./member-resolution');

const getOrCreate = getOrCreateCompanySubscription as jest.Mock;
const findUserCompany = prisma.userCompany.findUnique as jest.Mock;
const findUser = prisma.user.findUnique as jest.Mock;
const resolveOrCreate = memberResolution.resolveOrCreateMemberIdForUser as jest.Mock;
const removeMember = memberResolution.removeMemberForUser as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

function fakeClient(customerType = 'team'): MemberSyncClient {
  return {
    customers: {
      getExternal: jest.fn().mockResolvedValue({ id: 'cus_1', type: customerType }),
      members: { getExternal: jest.fn(), createExternal: jest.fn(), delete: jest.fn() },
    },
    members: { listMembers: jest.fn() },
  } as unknown as MemberSyncClient;
}

describe('syncCompanyMemberOnMembershipChange', () => {
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

    await syncCompanyMemberOnMembershipChange('company-1', 'user-1', client);

    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('is a no-op when the company has never checked out (no polarSubscriptionId)', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: null });
    const client = fakeClient();

    await syncCompanyMemberOnMembershipChange('company-1', 'user-1', client);

    expect(client.customers.getExternal as jest.Mock).not.toHaveBeenCalled();
  });

  it('is a no-op when the customer has not been promoted to team yet', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    const client = fakeClient('individual');

    await syncCompanyMemberOnMembershipChange('company-1', 'user-1', client);

    expect(findUserCompany).not.toHaveBeenCalled();
  });

  it('ensures a member exists for a user who is OWNER', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    findUserCompany.mockResolvedValue({ role: 'OWNER' });
    findUser.mockResolvedValue({ email: 'owner@acme.test', firstname: 'Ada', lastname: 'Owner' });
    const client = fakeClient('team');

    await syncCompanyMemberOnMembershipChange('company-1', 'user-1', client);

    expect(resolveOrCreate).toHaveBeenCalledWith(client, 'cus_1', 'company-1', {
      id: 'user-1',
      email: 'owner@acme.test',
      name: 'Ada Owner',
    });
    expect(removeMember).not.toHaveBeenCalled();
  });

  it('ensures a member exists for a user who is ADMIN', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    findUserCompany.mockResolvedValue({ role: 'ADMIN' });
    findUser.mockResolvedValue({ email: 'admin@acme.test', firstname: 'A', lastname: 'D' });
    const client = fakeClient('team');

    await syncCompanyMemberOnMembershipChange('company-1', 'user-2', client);

    expect(resolveOrCreate).toHaveBeenCalled();
  });

  it('removes the member for a user demoted to MEMBER', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    findUserCompany.mockResolvedValue({ role: 'MEMBER' });
    findUser.mockResolvedValue({ email: 'member@acme.test', firstname: 'M', lastname: 'B' });
    const client = fakeClient('team');

    await syncCompanyMemberOnMembershipChange('company-1', 'user-3', client);

    expect(removeMember).toHaveBeenCalledWith(client, 'cus_1', 'company-1', {
      id: 'user-3',
      email: 'member@acme.test',
      name: 'M B',
    });
    expect(resolveOrCreate).not.toHaveBeenCalled();
  });

  it('removes the member for a user removed from the company entirely (no membership row)', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    findUserCompany.mockResolvedValue(null);
    findUser.mockResolvedValue({ email: 'gone@acme.test', firstname: 'G', lastname: 'One' });
    const client = fakeClient('team');

    await syncCompanyMemberOnMembershipChange('company-1', 'user-4', client);

    expect(removeMember).toHaveBeenCalled();
  });

  it('uses a supplied knownUser instead of reading Prisma (the post-account-deletion case)', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    findUserCompany.mockResolvedValue(null); // cascaded away already
    const client = fakeClient('team');

    await syncCompanyMemberOnMembershipChange('company-1', 'user-5', client, {
      id: 'user-5',
      email: 'deleted@acme.test',
      name: 'Deleted User',
    });

    expect(findUser).not.toHaveBeenCalled();
    expect(removeMember).toHaveBeenCalledWith(client, 'cus_1', 'company-1', {
      id: 'user-5',
      email: 'deleted@acme.test',
      name: 'Deleted User',
    });
  });

  it('swallows a Polar failure and never throws', async () => {
    getOrCreate.mockResolvedValue({ polarSubscriptionId: 'sub_1' });
    findUserCompany.mockResolvedValue({ role: 'OWNER' });
    findUser.mockResolvedValue({ email: 'owner@acme.test', firstname: 'Ada', lastname: 'Owner' });
    resolveOrCreate.mockRejectedValue(new Error('polar down'));
    const client = fakeClient('team');

    await expect(syncCompanyMemberOnMembershipChange('company-1', 'user-1', client)).resolves.toBeUndefined();
  });
});
