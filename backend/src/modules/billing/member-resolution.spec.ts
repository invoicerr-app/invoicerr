import { vi } from 'vitest';

import { MissingBillingEmailError } from './billing-customer';
import {
  COMPANY_BILLING_MEMBER_EXTERNAL_ID,
  findMemberIdForUser,
  MemberResolutionClient,
  removeMemberForUser,
  resolveOrCreateCompanyBillingMemberId,
  resolveOrCreateMemberIdForUser,
} from './member-resolution';

const USER = { id: 'user-1', email: 'ada@acme.test', name: 'Ada' };
const BILLING = { email: 'billing@acme.test', name: 'Acme Inc' };

function notFoundError(): Error {
  return Object.assign(new Error('not found'), { statusCode: 404 });
}

async function* asPages(items: Array<{ id: string; email: string; externalId: string | null }>) {
  yield { result: { items } };
}

function fakeClient(overrides: Partial<MemberResolutionClient> = {}): MemberResolutionClient {
  return {
    members: { listMembers: vi.fn().mockResolvedValue(asPages([])) },
    customers: {
      members: {
        getExternal: vi.fn().mockRejectedValue(notFoundError()),
        createExternal: vi.fn(),
        delete: vi.fn(),
      },
    },
    ...overrides,
  } as unknown as MemberResolutionClient;
}

describe('findMemberIdForUser', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns the member found by our own externalId, without listing', async () => {
    const getExternal = vi.fn().mockResolvedValue({ id: 'member-1' });
    const listMembers = vi.fn();
    const client = fakeClient({
      customers: { members: { getExternal, createExternal: vi.fn(), delete: vi.fn() } },
      members: { listMembers },
    });

    const result = await findMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(getExternal).toHaveBeenCalledWith({ externalId: 'company-1', memberExternalId: 'user-1' });
    expect(listMembers).not.toHaveBeenCalled();
    expect(result).toBe('member-1');
  });

  it('falls back to matching by email when no externalId match exists', async () => {
    const listMembers = vi.fn().mockResolvedValue(
      asPages([
        { id: 'member-other', email: 'other@acme.test', externalId: null },
        { id: 'member-match', email: 'ada@acme.test', externalId: null },
      ]),
    );
    const client = fakeClient({ members: { listMembers } });

    const result = await findMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(result).toBe('member-match');
  });

  it("resolves Polar's own auto-created owner member (no externalId — minted on the company's first seat-based checkout) by matching the clicking user's email, using ITS OWN Polar-internal id from then on", async () => {
    // The exact shape a company's first seat-based checkout produces, Polar-side (this file's own
    // header): ONE `role: "owner"` member, minted straight from the customer's own email/name, with
    // no `externalId` this app ever set — never adopted into the externalId lookup path, matched by
    // email every time this function is called.
    const listMembers = vi
      .fn()
      .mockResolvedValue(asPages([{ id: 'member-auto-owner', email: 'ada@acme.test', externalId: null }]));
    const client = fakeClient({ members: { listMembers } });

    const result = await findMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(result).toBe('member-auto-owner');
  });

  it('returns null when nothing matches by externalId or email', async () => {
    const client = fakeClient();

    const result = await findMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(result).toBeNull();
  });

  it('re-throws a non-404 failure from the externalId lookup', async () => {
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockRejectedValue(new Error('polar down')),
          createExternal: vi.fn(),
          delete: vi.fn(),
        },
      },
    });

    await expect(findMemberIdForUser(client, 'cus_1', 'company-1', USER)).rejects.toThrow('polar down');
  });

  it('with matchByEmail: false, never even lists members and returns null when no externalId match exists', async () => {
    // Same fixture as the "auto-created owner member" test above (a member sharing this user's own
    // email exists) — but with the flag `removeMemberForUser` passes, this must NOT find it.
    const listMembers = vi
      .fn()
      .mockResolvedValue(asPages([{ id: 'member-auto-owner', email: 'ada@acme.test', externalId: null }]));
    const client = fakeClient({ members: { listMembers } });

    const result = await findMemberIdForUser(client, 'cus_1', 'company-1', USER, { matchByEmail: false });

    expect(result).toBeNull();
    expect(listMembers).not.toHaveBeenCalled();
  });
});

describe('resolveOrCreateMemberIdForUser', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns the existing member id without creating one', async () => {
    const createExternal = vi.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockResolvedValue({ id: 'member-1' }),
          createExternal,
          delete: vi.fn(),
        },
      },
    });

    const result = await resolveOrCreateMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(result).toBe('member-1');
    expect(createExternal).not.toHaveBeenCalled();
  });

  it('creates a fresh member, keyed by our own externalId, when none exists', async () => {
    const createExternal = vi.fn().mockResolvedValue({ id: 'member-new' });
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockRejectedValue(notFoundError()),
          createExternal,
          delete: vi.fn(),
        },
      },
    });

    const result = await resolveOrCreateMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(createExternal).toHaveBeenCalledWith({
      externalId: 'company-1',
      memberCreateFromCustomer: { email: 'ada@acme.test', name: 'Ada', externalId: 'user-1' },
    });
    expect(result).toBe('member-new');
  });
});

describe('resolveOrCreateCompanyBillingMemberId', () => {
  afterEach(() => vi.resetAllMocks());

  it('resolves the existing member by the sentinel company externalId, without creating one', async () => {
    const getExternal = vi.fn().mockResolvedValue({ id: 'member-company' });
    const createExternal = vi.fn();
    const client = fakeClient({
      customers: { members: { getExternal, createExternal, delete: vi.fn() } },
    });

    const result = await resolveOrCreateCompanyBillingMemberId(client, 'cus_1', 'company-1', BILLING);

    expect(getExternal).toHaveBeenCalledWith({
      externalId: 'company-1',
      memberExternalId: COMPANY_BILLING_MEMBER_EXTERNAL_ID,
    });
    expect(result).toBe('member-company');
    expect(createExternal).not.toHaveBeenCalled();
  });

  it("reuses Polar's own auto-created owner member when its email already matches the resolved billing email — the common case right after a company's first seat-based checkout", async () => {
    const listMembers = vi
      .fn()
      .mockResolvedValue(asPages([{ id: 'member-auto-owner', email: BILLING.email, externalId: null }]));
    const createExternal = vi.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockRejectedValue(notFoundError()),
          createExternal,
          delete: vi.fn(),
        },
      },
      members: { listMembers },
    });

    const result = await resolveOrCreateCompanyBillingMemberId(client, 'cus_1', 'company-1', BILLING);

    expect(result).toBe('member-auto-owner');
    expect(createExternal).not.toHaveBeenCalled();
  });

  it('creates a fresh member as role "billing_manager" — never the default "member" role — when nothing matches', async () => {
    const createExternal = vi.fn().mockResolvedValue({ id: 'member-new-billing' });
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockRejectedValue(notFoundError()),
          createExternal,
          delete: vi.fn(),
        },
      },
      members: { listMembers: vi.fn().mockResolvedValue(asPages([])) },
    });

    const result = await resolveOrCreateCompanyBillingMemberId(client, 'cus_1', 'company-1', BILLING);

    expect(createExternal).toHaveBeenCalledWith({
      externalId: 'company-1',
      memberCreateFromCustomer: {
        email: BILLING.email,
        name: BILLING.name,
        externalId: COMPANY_BILLING_MEMBER_EXTERNAL_ID,
        role: 'billing_manager',
      },
    });
    expect(result).toBe('member-new-billing');
  });

  it("never resolves to a member found under a real user's own externalId — only the sentinel", async () => {
    // `USER.id` ('user-1') must NEVER be looked up by this function — it stands for the COMPANY, not
    // any particular Invoicerr user (the exact bug this function exists to fix).
    const getExternal = vi.fn().mockRejectedValue(notFoundError());
    const createExternal = vi.fn().mockResolvedValue({ id: 'member-new-billing' });
    const client = fakeClient({
      customers: { members: { getExternal, createExternal, delete: vi.fn() } },
    });

    await resolveOrCreateCompanyBillingMemberId(client, 'cus_1', 'company-1', BILLING);

    expect(getExternal).not.toHaveBeenCalledWith(expect.objectContaining({ memberExternalId: USER.id }));
  });

  // Reachable when `Company.billingEmail`/`Company.email` went blank AFTER this company was already
  // promoted to a `team` customer, so nothing matches the (now empty) resolved billing email any more
  // — same guard `billing-customer.ts#getOrCreatePolarCustomerForCompany` holds for the CUSTOMER
  // create call, here for the MEMBER create call.
  it('refuses BEFORE calling Polar when the resolved billing email is empty and no existing member matches', async () => {
    const createExternal = vi.fn();
    const client = fakeClient({
      customers: {
        members: { getExternal: vi.fn().mockRejectedValue(notFoundError()), createExternal, delete: vi.fn() },
      },
      members: { listMembers: vi.fn().mockResolvedValue(asPages([])) },
    });

    const error = await resolveOrCreateCompanyBillingMemberId(client, 'cus_1', 'company-1', {
      email: '',
      name: 'Acme Inc',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MissingBillingEmailError);
    expect(createExternal).not.toHaveBeenCalled();
  });
});

describe('removeMemberForUser', () => {
  afterEach(() => vi.resetAllMocks());

  it('deletes the found member by its Polar-internal id', async () => {
    const del = vi.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockResolvedValue({ id: 'member-1' }),
          createExternal: vi.fn(),
          delete: del,
        },
      },
    });

    await removeMemberForUser(client, 'cus_1', 'company-1', USER);

    expect(del).toHaveBeenCalledWith({ id: 'cus_1', memberId: 'member-1' });
  });

  it('is a no-op when no member exists at all', async () => {
    const del = vi.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockRejectedValue(notFoundError()),
          createExternal: vi.fn(),
          delete: del,
        },
      },
    });

    await removeMemberForUser(client, 'cus_1', 'company-1', USER);

    expect(del).not.toHaveBeenCalled();
  });

  it(
    'NEVER deletes a member found only by email — the reproduction of the incident this fix closes: ' +
      "Polar's own auto-created owner member happens to share this user's own billing email, and a " +
      'demotion/removal for this user must not strip the company of it',
    async () => {
      const del = vi.fn();
      const listMembers = vi
        .fn()
        .mockResolvedValue(asPages([{ id: 'member-auto-owner', email: 'ada@acme.test', externalId: null }]));
      const client = fakeClient({
        customers: {
          members: {
            getExternal: vi.fn().mockRejectedValue(notFoundError()), // no member under OUR externalId
            createExternal: vi.fn(),
            delete: del,
          },
        },
        members: { listMembers },
      });

      await removeMemberForUser(client, 'cus_1', 'company-1', USER);

      // Not merely "found but declined to delete" — the email lookup never even runs for a deletion.
      expect(listMembers).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    },
  );

  it('still deletes a member found by OUR OWN externalId — the fix narrows the match, it does not disable deletion entirely', async () => {
    const del = vi.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: vi.fn().mockResolvedValue({ id: 'member-ours' }),
          createExternal: vi.fn(),
          delete: del,
        },
      },
    });

    await removeMemberForUser(client, 'cus_1', 'company-1', USER);

    expect(del).toHaveBeenCalledWith({ id: 'cus_1', memberId: 'member-ours' });
  });
});
