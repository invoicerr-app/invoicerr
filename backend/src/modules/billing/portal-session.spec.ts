import { vi } from 'vitest';

import {
  BILLING_NO_COMPANY_CUSTOMER_CODE,
  createCustomerPortalSession,
  createLegacyCustomerPortalSession,
  PolarCustomerNotFoundError,
  PortalSessionClient,
} from './portal-session';

const CLICKING_USER = { id: 'user-1', email: 'owner@acme.test', name: 'Ada Owner' };
const COMPANY_BILLING = { email: 'billing@acme.test', name: 'Acme Inc' };

function fakeClient(overrides: Partial<PortalSessionClient> = {}): PortalSessionClient {
  return {
    customers: {
      getExternal: vi.fn(),
      members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
    },
    members: { listMembers: vi.fn() },
    customerSessions: { create: vi.fn() },
    ...overrides,
  } as unknown as PortalSessionClient;
}

async function* asPages(items: Array<{ id: string; email: string; externalId: string | null }>) {
  yield { result: { items } };
}

describe('createCustomerPortalSession', () => {
  it('opens a session by externalCustomerId for an individual customer — no memberId, no member lookup', async () => {
    const create = vi.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/abc' });
    const listMembers = vi.fn();
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_1', type: 'individual' }),
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      },
      members: { listMembers },
      customerSessions: { create },
    });

    const result = await createCustomerPortalSession(
      'company-1',
      COMPANY_BILLING,
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

  it("opens a session for the COMPANY's own billing member — already known by its own sentinel externalId, never a user's", async () => {
    const create = vi.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team' });
    const getExternalMember = vi.fn().mockResolvedValue({ id: 'member-company-billing' });
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_team', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal: vi.fn(), delete: vi.fn() },
      },
      customerSessions: { create },
    });

    const result = await createCustomerPortalSession(
      'company-2',
      COMPANY_BILLING,
      'https://app/settings/billing',
      client,
    );

    // Resolved by the company's own sentinel id (`__company_billing__`), NEVER by `CLICKING_USER.id` —
    // this is the exact bug this function fixes: the portal must not depend on who clicked.
    expect(getExternalMember).toHaveBeenCalledWith({
      externalId: 'company-2',
      memberExternalId: '__company_billing__',
    });
    expect(create).toHaveBeenCalledWith({
      customerId: 'cus_team',
      memberId: 'member-company-billing',
      returnUrl: 'https://app/settings/billing',
    });
    expect(result).toEqual({ url: 'https://polar.sh/portal/team', redirect: true });
  });

  it("falls back to matching by email (Polar's own auto-created owner member, minted from the company's own billing email) when no sentinel externalId match exists", async () => {
    const create = vi.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team2' });
    const getExternalMember = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const listMembers = vi
      .fn()
      .mockResolvedValue(
        asPages([{ id: 'member-auto-owner', email: COMPANY_BILLING.email, externalId: null }]),
      );
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_team2', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal: vi.fn(), delete: vi.fn() },
      },
      members: { listMembers },
      customerSessions: { create },
    });

    await createCustomerPortalSession('company-3', COMPANY_BILLING, 'https://app/settings/billing', client);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member-auto-owner' }));
  });

  it('creates a fresh company billing member, role billing_manager, when neither lookup matches', async () => {
    const create = vi.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/team3' });
    const getExternalMember = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const createExternal = vi.fn().mockResolvedValue({ id: 'member-new' });
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_team3', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal, delete: vi.fn() },
      },
      members: { listMembers: vi.fn().mockResolvedValue(asPages([])) },
      customerSessions: { create },
    });

    await createCustomerPortalSession('company-4', COMPANY_BILLING, 'https://app/settings/billing', client);

    expect(createExternal).toHaveBeenCalledWith({
      externalId: 'company-4',
      memberCreateFromCustomer: {
        email: COMPANY_BILLING.email,
        name: COMPANY_BILLING.name,
        externalId: '__company_billing__',
        role: 'billing_manager',
      },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member-new' }));
  });

  it('throws PolarCustomerNotFoundError when the company has no Polar customer yet', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 })),
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      },
    });

    const error = await createCustomerPortalSession(
      'company-5',
      COMPANY_BILLING,
      'https://app/settings/billing',
      client,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(PolarCustomerNotFoundError);
    expect(error.code).toBe(BILLING_NO_COMPANY_CUSTOMER_CODE);
    expect(client.customerSessions.create).not.toHaveBeenCalled();
  });

  it('re-throws any other Polar failure unchanged', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockRejectedValue(new Error('polar is down')),
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      },
    });

    await expect(
      createCustomerPortalSession('company-6', COMPANY_BILLING, 'https://app/settings/billing', client),
    ).rejects.toThrow('polar is down');
  });
});

describe('createLegacyCustomerPortalSession', () => {
  it("opens a session keyed by the CLICKING user's own id, not a company id", async () => {
    const create = vi.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/legacy' });
    const getExternal = vi.fn().mockResolvedValue({ id: 'cus_legacy', type: 'individual' });
    const client = fakeClient({
      customers: {
        getExternal,
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      },
      customerSessions: { create },
    });

    const result = await createLegacyCustomerPortalSession(
      CLICKING_USER,
      'https://app/settings/billing',
      client,
    );

    expect(getExternal).toHaveBeenCalledWith({ externalId: CLICKING_USER.id });
    expect(create).toHaveBeenCalledWith({
      externalCustomerId: CLICKING_USER.id,
      returnUrl: 'https://app/settings/billing',
    });
    expect(result).toEqual({ url: 'https://polar.sh/portal/legacy', redirect: true });
  });

  it("still resolves a member by the CLICKING user's own identity for a team legacy customer — unlike the company-scoped portal above", async () => {
    const create = vi.fn().mockResolvedValue({ customerPortalUrl: 'https://polar.sh/portal/legacy-team' });
    const getExternal = vi.fn().mockResolvedValue({ id: 'cus_legacy_team', type: 'team' });
    const getExternalMember = vi.fn().mockResolvedValue({ id: 'member-legacy-user' });
    const client = fakeClient({
      customers: {
        getExternal,
        members: { getExternal: getExternalMember, createExternal: vi.fn(), delete: vi.fn() },
      },
      customerSessions: { create },
    });

    await createLegacyCustomerPortalSession(CLICKING_USER, 'https://app/settings/billing', client);

    expect(getExternalMember).toHaveBeenCalledWith({
      externalId: CLICKING_USER.id,
      memberExternalId: CLICKING_USER.id,
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member-legacy-user' }));
  });

  it('throws PolarCustomerNotFoundError (keyed by the user id) when no legacy customer exists', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 })),
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      },
    });

    const error = await createLegacyCustomerPortalSession(
      CLICKING_USER,
      'https://app/settings/billing',
      client,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(PolarCustomerNotFoundError);
    expect(error.externalId).toBe(CLICKING_USER.id);
  });
});
