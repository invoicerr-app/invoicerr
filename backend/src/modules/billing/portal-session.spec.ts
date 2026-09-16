import {
  createCustomerPortalSession,
  PolarCustomerNotFoundError,
  PortalSessionClient,
} from './portal-session';

const CLICKING_USER = { id: 'user-1', email: 'owner@acme.test', name: 'Ada Owner' };

function fakeClient(overrides: Partial<PortalSessionClient> = {}): PortalSessionClient {
  return {
    customers: {
      getExternal: jest.fn(),
      members: { getExternal: jest.fn(), createExternal: jest.fn(), delete: jest.fn() },
    },
    members: { listMembers: jest.fn() },
    customerSessions: { create: jest.fn() },
    ...overrides,
  } as unknown as PortalSessionClient;
}

async function* asPages(items: Array<{ id: string; email: string; externalId: string | null }>) {
  yield { result: { items } };
}

describe('createCustomerPortalSession', () => {
  it('opens a session by externalCustomerId for an individual customer — no memberId, no member lookup', async () => {
    const create = jest.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/abc' });
    const listMembers = jest.fn();
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_1', type: 'individual' }),
        members: { getExternal: jest.fn(), createExternal: jest.fn(), delete: jest.fn() },
      },
      members: { listMembers },
      customerSessions: { create },
    });

    const result = await createCustomerPortalSession(
      'company-1',
      CLICKING_USER,
      'https://app/settings/billing',
      client,
    );

    expect(create).toHaveBeenCalledWith({
      externalCustomerId: 'company-1',
      returnUrl: 'https://app/settings/billing',
    });
    expect(listMembers).not.toHaveBeenCalled();
    expect(result).toEqual({ url: 'https://polar.sh/portal/abc', redirect: true });
  });

  it("opens a session for the CLICKING user's own member — already known by our own externalId", async () => {
    const create = jest.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team' });
    const getExternalMember = jest.fn().mockResolvedValue({ id: 'member-clicking-user' });
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_team', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal: jest.fn(), delete: jest.fn() },
      },
      customerSessions: { create },
    });

    const result = await createCustomerPortalSession(
      'company-2',
      CLICKING_USER,
      'https://app/settings/billing',
      client,
    );

    expect(getExternalMember).toHaveBeenCalledWith({ externalId: 'company-2', memberExternalId: 'user-1' });
    expect(create).toHaveBeenCalledWith({
      customerId: 'cus_team',
      memberId: 'member-clicking-user',
      returnUrl: 'https://app/settings/billing',
    });
    expect(result).toEqual({ url: 'https://polar.sh/portal/team', redirect: true });
  });

  it("falls back to matching by email (Polar's own auto-created owner member) when no externalId match exists", async () => {
    const create = jest.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team2' });
    const getExternalMember = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const listMembers = jest
      .fn()
      .mockResolvedValue(asPages([{ id: 'member-auto-owner', email: 'owner@acme.test', externalId: null }]));
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_team2', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal: jest.fn(), delete: jest.fn() },
      },
      members: { listMembers },
      customerSessions: { create },
    });

    await createCustomerPortalSession('company-3', CLICKING_USER, 'https://app/settings/billing', client);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member-auto-owner' }));
  });

  it('creates a fresh member for the clicking user when neither lookup matches', async () => {
    const create = jest.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team3' });
    const getExternalMember = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const createExternal = jest.fn().mockResolvedValue({ id: 'member-new' });
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockResolvedValue({ id: 'cus_team3', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal, delete: jest.fn() },
      },
      members: { listMembers: jest.fn().mockResolvedValue(asPages([])) },
      customerSessions: { create },
    });

    await createCustomerPortalSession('company-4', CLICKING_USER, 'https://app/settings/billing', client);

    expect(createExternal).toHaveBeenCalledWith({
      externalId: 'company-4',
      memberCreateFromCustomer: { email: 'owner@acme.test', name: 'Ada Owner', externalId: 'user-1' },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member-new' }));
  });

  it('throws PolarCustomerNotFoundError when the company has no Polar customer yet', async () => {
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 })),
        members: { getExternal: jest.fn(), createExternal: jest.fn(), delete: jest.fn() },
      },
    });

    await expect(
      createCustomerPortalSession('company-5', CLICKING_USER, 'https://app/settings/billing', client),
    ).rejects.toThrow(PolarCustomerNotFoundError);
    expect(client.customerSessions.create).not.toHaveBeenCalled();
  });

  it('re-throws any other Polar failure unchanged', async () => {
    const client = fakeClient({
      customers: {
        getExternal: jest.fn().mockRejectedValue(new Error('polar is down')),
        members: { getExternal: jest.fn(), createExternal: jest.fn(), delete: jest.fn() },
      },
    });

    await expect(
      createCustomerPortalSession('company-6', CLICKING_USER, 'https://app/settings/billing', client),
    ).rejects.toThrow('polar is down');
  });
});
