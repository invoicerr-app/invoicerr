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
      members: {
        getExternal: vi.fn(),
        createExternal: vi.fn(),
        delete: vi.fn(),
        iterList: vi.fn().mockReturnValue(asItems([])),
      },
    },
    customerSessions: { create: vi.fn() },
    ...overrides,
  } as unknown as PortalSessionClient;
}

// #537: `customers.members.iterList` (`@polar-sh/sdk@1.0.0`) yields MEMBERS directly, not pages
// wrapping a `result.items` array the way 0.49's `members.listMembers` used to.
async function* asItems(items: Array<{ id: string; email: string; external_id: string | null }>) {
  yield* items;
}

describe('createCustomerPortalSession', () => {
  it('opens a session by external_customer_id for an individual customer, no memberId, no member lookup', async () => {
    const create = vi.fn().mockResolvedValue({ customer_portal_url: 'https://polar.sh/portal/abc' });
    const iterList = vi.fn().mockReturnValue(asItems([]));
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_1', type: 'individual' }),
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn(), iterList },
      } as unknown as PortalSessionClient['customers'],
      customerSessions: { create },
    });

    const result = await createCustomerPortalSession(
      'company-1',
      COMPANY_BILLING,
      'https://app/settings/billing',
      client,
    );

    expect(create).toHaveBeenCalledWith({
      external_customer_id: 'company-1',
      return_url: 'https://app/settings/billing',
    });
    expect(iterList).not.toHaveBeenCalled();
    expect(result).toEqual({ url: 'https://polar.sh/portal/abc', redirect: true });
  });

  it("opens a session for the COMPANY's own billing member, already known by its own sentinel externalId, never a user's", async () => {
    const create = vi.fn().mockResolvedValue({ customer_portal_url: 'https://polar.sh/portal/team' });
    const getExternalMember = vi.fn().mockResolvedValue({ id: 'member-company-billing' });
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_team', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal: vi.fn(), delete: vi.fn() },
      } as unknown as PortalSessionClient['customers'],
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
    expect(getExternalMember).toHaveBeenCalledWith('company-2', '__company_billing__');
    expect(create).toHaveBeenCalledWith({
      customer_id: 'cus_team',
      member_id: 'member-company-billing',
      return_url: 'https://app/settings/billing',
    });
    expect(result).toEqual({ url: 'https://polar.sh/portal/team', redirect: true });
  });

  it("falls back to matching by email (Polar's own auto-created owner member, minted from the company's own billing email) when no sentinel externalId match exists", async () => {
    const create = vi.fn().mockResolvedValue({ customer_portal_url: 'https://polar.sh/portal/team2' });
    const getExternalMember = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const iterList = vi
      .fn()
      .mockReturnValue(
        asItems([{ id: 'member-auto-owner', email: COMPANY_BILLING.email, external_id: null }]),
      );
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_team2', type: 'team' }),
        members: { getExternal: getExternalMember, createExternal: vi.fn(), delete: vi.fn(), iterList },
      } as unknown as PortalSessionClient['customers'],
      customerSessions: { create },
    });

    await createCustomerPortalSession('company-3', COMPANY_BILLING, 'https://app/settings/billing', client);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ member_id: 'member-auto-owner' }));
  });

  it('creates a fresh company billing member, role billing_manager, when neither lookup matches', async () => {
    const create = vi.fn().mockResolvedValue({ customer_portal_url: 'https://polar.sh/portal/team3' });
    const getExternalMember = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const createExternal = vi.fn().mockResolvedValue({ id: 'member-new' });
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockResolvedValue({ id: 'cus_team3', type: 'team' }),
        members: {
          getExternal: getExternalMember,
          createExternal,
          delete: vi.fn(),
          iterList: vi.fn().mockReturnValue(asItems([])),
        },
      } as unknown as PortalSessionClient['customers'],
      customerSessions: { create },
    });

    await createCustomerPortalSession('company-4', COMPANY_BILLING, 'https://app/settings/billing', client);

    expect(createExternal).toHaveBeenCalledWith('company-4', {
      email: COMPANY_BILLING.email,
      name: COMPANY_BILLING.name,
      external_id: '__company_billing__',
      role: 'billing_manager',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ member_id: 'member-new' }));
  });

  it('throws PolarCustomerNotFoundError when the company has no Polar customer yet', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 })),
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      } as unknown as PortalSessionClient['customers'],
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
      } as unknown as PortalSessionClient['customers'],
    });

    await expect(
      createCustomerPortalSession('company-6', COMPANY_BILLING, 'https://app/settings/billing', client),
    ).rejects.toThrow('polar is down');
  });
});

describe('createLegacyCustomerPortalSession', () => {
  it("opens a session keyed by the CLICKING user's own id, not a company id", async () => {
    const create = vi.fn().mockResolvedValue({ customer_portal_url: 'https://polar.sh/portal/legacy' });
    const getExternal = vi.fn().mockResolvedValue({ id: 'cus_legacy', type: 'individual' });
    const client = fakeClient({
      customers: {
        getExternal,
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      } as unknown as PortalSessionClient['customers'],
      customerSessions: { create },
    });

    const result = await createLegacyCustomerPortalSession(
      CLICKING_USER,
      'https://app/settings/billing',
      client,
    );

    expect(getExternal).toHaveBeenCalledWith(CLICKING_USER.id);
    expect(create).toHaveBeenCalledWith({
      external_customer_id: CLICKING_USER.id,
      return_url: 'https://app/settings/billing',
    });
    expect(result).toEqual({ url: 'https://polar.sh/portal/legacy', redirect: true });
  });

  it("still resolves a member by the CLICKING user's own identity for a team legacy customer, unlike the company-scoped portal above", async () => {
    const create = vi.fn().mockResolvedValue({ customer_portal_url: 'https://polar.sh/portal/legacy-team' });
    const getExternal = vi.fn().mockResolvedValue({ id: 'cus_legacy_team', type: 'team' });
    const getExternalMember = vi.fn().mockResolvedValue({ id: 'member-legacy-user' });
    const client = fakeClient({
      customers: {
        getExternal,
        members: { getExternal: getExternalMember, createExternal: vi.fn(), delete: vi.fn() },
      } as unknown as PortalSessionClient['customers'],
      customerSessions: { create },
    });

    await createLegacyCustomerPortalSession(CLICKING_USER, 'https://app/settings/billing', client);

    expect(getExternalMember).toHaveBeenCalledWith(CLICKING_USER.id, CLICKING_USER.id);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ member_id: 'member-legacy-user' }));
  });

  it('throws PolarCustomerNotFoundError (keyed by the user id) when no legacy customer exists', async () => {
    const client = fakeClient({
      customers: {
        getExternal: vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 })),
        members: { getExternal: vi.fn(), createExternal: vi.fn(), delete: vi.fn() },
      } as unknown as PortalSessionClient['customers'],
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
