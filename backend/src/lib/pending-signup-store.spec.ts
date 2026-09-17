import { PendingSignupRedisClient, createPendingSignupStore } from '@/lib/pending-signup-store';

/**
 * A fake honoring exactly `PendingSignupRedisClient` — no real Redis connection, but the same
 * shared-storage SEMANTICS a second process reading through a real client would see (a plain value
 * store keyed by string, `EX` recorded as an expiry the fake actually enforces): this is what proves
 * the store no longer depends on two requests sharing one process's memory, without needing a live
 * Redis for a unit spec (real cross-replica behavior is out of reach for a unit test either way; the
 * regression this file guards is "the store's own read/write/delete contract", not the network).
 */
function fakeRedisClient(now: () => number = () => Date.now()): PendingSignupRedisClient {
  const rows = new Map<string, { value: string; expiresAt: number }>();
  return {
    async set(key, value, _mode, ttlSeconds) {
      rows.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return 'OK';
    },
    async get(key) {
      const row = rows.get(key);
      if (!row) return null;
      if (row.expiresAt <= now()) {
        rows.delete(key);
        return null;
      }
      return row.value;
    },
    async del(key) {
      const existed = rows.has(key);
      rows.delete(key);
      return existed ? 1 : 0;
    },
  };
}

describe('createPendingSignupStore — invitation codes', () => {
  it('reads back exactly what was set, across what would be two different requests', async () => {
    const store = createPendingSignupStore(fakeRedisClient());
    await store.setPendingInvitationCode('ada@acme.test', 'CODE123');
    // A second call, sharing only the same underlying client — this is the load-bearing behavior a
    // bare `Map` cannot give two different API replicas: it's the same object here only because this
    // is one process, but the store itself makes no assumption of that.
    expect(await store.getPendingInvitationCode('ada@acme.test')).toBe('CODE123');
  });

  it("is case-insensitive on the email, matching the controller's own `.toLowerCase()` call", async () => {
    const store = createPendingSignupStore(fakeRedisClient());
    await store.setPendingInvitationCode('Ada@Acme.test', 'CODE123');
    expect(await store.getPendingInvitationCode('ada@acme.test')).toBe('CODE123');
  });

  it('returns null for a code nobody ever deposited', async () => {
    const store = createPendingSignupStore(fakeRedisClient());
    expect(await store.getPendingInvitationCode('ghost@acme.test')).toBeNull();
  });

  it('forgets a code once deleted — a refused/consumed code must not be replayable', async () => {
    const store = createPendingSignupStore(fakeRedisClient());
    await store.setPendingInvitationCode('ada@acme.test', 'CODE123');
    await store.deletePendingInvitationCode('ada@acme.test');
    expect(await store.getPendingInvitationCode('ada@acme.test')).toBeNull();
  });

  it('expires on its own after the TTL — a ghost entry cannot outlive it, unlike the old Map', async () => {
    let clock = 1_000_000;
    const store = createPendingSignupStore(fakeRedisClient(() => clock));
    await store.setPendingInvitationCode('ada@acme.test', 'CODE123');
    clock += 60 * 60 * 1000 + 1; // one hour and one millisecond later
    expect(await store.getPendingInvitationCode('ada@acme.test')).toBeNull();
  });
});

describe('createPendingSignupStore — deleted-user memberships', () => {
  const memberships = [{ companyId: 'company-1', role: 'OWNER' as const }];

  it('take* both returns AND clears the row in one call, so it cannot be read twice', async () => {
    const store = createPendingSignupStore(fakeRedisClient());
    await store.setPendingMembershipsForDeletedUser('user-1', memberships as never);
    expect(await store.takePendingMembershipsForDeletedUser('user-1')).toEqual(memberships);
    expect(await store.takePendingMembershipsForDeletedUser('user-1')).toEqual([]);
  });

  it('returns an empty array, never throws, when nothing was ever deposited for this user', async () => {
    const store = createPendingSignupStore(fakeRedisClient());
    expect(await store.takePendingMembershipsForDeletedUser('user-without-a-pending-row')).toEqual([]);
  });
});
