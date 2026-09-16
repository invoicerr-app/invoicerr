import {
  findMemberIdForUser,
  MemberResolutionClient,
  removeMemberForUser,
  resolveOrCreateMemberIdForUser,
} from './member-resolution';

const USER = { id: 'user-1', email: 'ada@acme.test', name: 'Ada' };

function notFoundError(): Error {
  return Object.assign(new Error('not found'), { statusCode: 404 });
}

async function* asPages(items: Array<{ id: string; email: string; externalId: string | null }>) {
  yield { result: { items } };
}

function fakeClient(overrides: Partial<MemberResolutionClient> = {}): MemberResolutionClient {
  return {
    members: { listMembers: jest.fn().mockResolvedValue(asPages([])) },
    customers: {
      members: {
        getExternal: jest.fn().mockRejectedValue(notFoundError()),
        createExternal: jest.fn(),
        delete: jest.fn(),
      },
    },
    ...overrides,
  } as unknown as MemberResolutionClient;
}

describe('findMemberIdForUser', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns the member found by our own externalId, without listing', async () => {
    const getExternal = jest.fn().mockResolvedValue({ id: 'member-1' });
    const listMembers = jest.fn();
    const client = fakeClient({
      customers: { members: { getExternal, createExternal: jest.fn(), delete: jest.fn() } },
      members: { listMembers },
    });

    const result = await findMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(getExternal).toHaveBeenCalledWith({ externalId: 'company-1', memberExternalId: 'user-1' });
    expect(listMembers).not.toHaveBeenCalled();
    expect(result).toBe('member-1');
  });

  it('falls back to matching by email when no externalId match exists', async () => {
    const listMembers = jest.fn().mockResolvedValue(
      asPages([
        { id: 'member-other', email: 'other@acme.test', externalId: null },
        { id: 'member-match', email: 'ada@acme.test', externalId: null },
      ]),
    );
    const client = fakeClient({ members: { listMembers } });

    const result = await findMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(result).toBe('member-match');
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
          getExternal: jest.fn().mockRejectedValue(new Error('polar down')),
          createExternal: jest.fn(),
          delete: jest.fn(),
        },
      },
    });

    await expect(findMemberIdForUser(client, 'cus_1', 'company-1', USER)).rejects.toThrow('polar down');
  });
});

describe('resolveOrCreateMemberIdForUser', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns the existing member id without creating one', async () => {
    const createExternal = jest.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: jest.fn().mockResolvedValue({ id: 'member-1' }),
          createExternal,
          delete: jest.fn(),
        },
      },
    });

    const result = await resolveOrCreateMemberIdForUser(client, 'cus_1', 'company-1', USER);

    expect(result).toBe('member-1');
    expect(createExternal).not.toHaveBeenCalled();
  });

  it('creates a fresh member, keyed by our own externalId, when none exists', async () => {
    const createExternal = jest.fn().mockResolvedValue({ id: 'member-new' });
    const client = fakeClient({
      customers: {
        members: {
          getExternal: jest.fn().mockRejectedValue(notFoundError()),
          createExternal,
          delete: jest.fn(),
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

describe('removeMemberForUser', () => {
  afterEach(() => jest.resetAllMocks());

  it('deletes the found member by its Polar-internal id', async () => {
    const del = jest.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: jest.fn().mockResolvedValue({ id: 'member-1' }),
          createExternal: jest.fn(),
          delete: del,
        },
      },
    });

    await removeMemberForUser(client, 'cus_1', 'company-1', USER);

    expect(del).toHaveBeenCalledWith({ id: 'cus_1', memberId: 'member-1' });
  });

  it('is a no-op when no member exists at all', async () => {
    const del = jest.fn();
    const client = fakeClient({
      customers: {
        members: {
          getExternal: jest.fn().mockRejectedValue(notFoundError()),
          createExternal: jest.fn(),
          delete: del,
        },
      },
    });

    await removeMemberForUser(client, 'cus_1', 'company-1', USER);

    expect(del).not.toHaveBeenCalled();
  });
});
