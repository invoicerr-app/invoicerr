import { createCustomerPortalSession, PortalSessionClient } from './portal-session';

function fakeClient(overrides: Partial<PortalSessionClient>): PortalSessionClient {
  return {
    customers: { getExternal: jest.fn() },
    members: { listMembers: jest.fn() },
    customerSessions: { create: jest.fn() },
    ...overrides,
  } as unknown as PortalSessionClient;
}

async function* asPages(items: Array<{ id: string; role: string }>) {
  yield { result: { items } };
}

describe('createCustomerPortalSession', () => {
  it('opens a session by externalCustomerId for an individual customer — no memberId', async () => {
    const create = jest.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/abc' });
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockResolvedValue({ id: 'cus_1', type: 'individual' }) },
      customerSessions: { create },
    });

    const result = await createCustomerPortalSession('user-1', 'https://app/settings/billing', client);

    expect(create).toHaveBeenCalledWith({
      externalCustomerId: 'user-1',
      returnUrl: 'https://app/settings/billing',
    });
    expect(result).toEqual({ url: 'https://polar.sh/portal/abc', redirect: true });
  });

  it('looks up the owner member and opens a session by customerId + memberId for a team customer', async () => {
    const create = jest.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team' });
    const listMembers = jest.fn().mockResolvedValue(
      asPages([
        { id: 'member-owner', role: 'owner' },
        { id: 'member-other', role: 'member' },
      ]),
    );
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockResolvedValue({ id: 'cus_team', type: 'team' }) },
      members: { listMembers },
      customerSessions: { create },
    });

    const result = await createCustomerPortalSession('user-2', 'https://app/settings/billing', client);

    expect(listMembers).toHaveBeenCalledWith({ customerId: 'cus_team' });
    expect(create).toHaveBeenCalledWith({
      customerId: 'cus_team',
      memberId: 'member-owner',
      returnUrl: 'https://app/settings/billing',
    });
    expect(result).toEqual({ url: 'https://polar.sh/portal/team', redirect: true });
  });

  it('falls back to the first listed member when none is explicitly the owner', async () => {
    const create = jest.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team2' });
    const listMembers = jest.fn().mockResolvedValue(asPages([{ id: 'member-only', role: 'admin' }]));
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockResolvedValue({ id: 'cus_team2', type: 'team' }) },
      members: { listMembers },
      customerSessions: { create },
    });

    await createCustomerPortalSession('user-3', 'https://app/settings/billing', client);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_team2', memberId: 'member-only' }),
    );
  });

  it('throws a named error rather than calling Polar when a team customer has no member at all', async () => {
    const listMembers = jest.fn().mockResolvedValue(asPages([]));
    const client = fakeClient({
      customers: { getExternal: jest.fn().mockResolvedValue({ id: 'cus_empty', type: 'team' }) },
      members: { listMembers },
    });

    await expect(
      createCustomerPortalSession('user-4', 'https://app/settings/billing', client),
    ).rejects.toThrow('Polar team customer cus_empty has no member to open a portal session for');
    expect(client.customerSessions.create).not.toHaveBeenCalled();
  });
});
