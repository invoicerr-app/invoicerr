/**
 * `SsoRegistrySyncService`'s real end-to-end proof — real Redis, two independent instances (each with
 * its OWN pair of ioredis connections, exactly like two separate API replica processes would each open
 * their own), never a fake bus. The unit spec (`sso-registrar.service.spec.ts`'s own "cross-replica
 * sync" describe block) proves the REGISTRATION logic with a fake `SsoRegistrySync`; this file proves
 * the actual pub/sub plumbing underneath it.
 *
 * Gated EXPLICITLY (`SSO_REGISTRY_SYNC_REDIS_TESTS=1`), same discipline
 * `lib/auth-rate-limit.redis.spec.ts` and `modules/documents/queue/__tests__/*.redis.spec.ts` already
 * document: a bare local `npx vitest run` loads `.env`, so `REDIS_URL` is always set on a dev machine —
 * this must not silently start hitting a real Redis on every run.
 */
import { SsoRegistrySyncMessage } from './sso-registry-sync';
import { SsoRegistrySyncService } from './sso-registry-sync.service';

const hasRedis = !!process.env.REDIS_URL && process.env.SSO_REGISTRY_SYNC_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, 10);
    };
    check();
  });
}

describeWithRedis('SsoRegistrySyncService — real Redis, two independent instances', () => {
  let replicaA: SsoRegistrySyncService;
  let replicaB: SsoRegistrySyncService;

  beforeEach(() => {
    replicaA = new SsoRegistrySyncService();
    replicaB = new SsoRegistrySyncService();
  });

  afterEach(async () => {
    await replicaA.onModuleDestroy();
    await replicaB.onModuleDestroy();
  });

  it("a publish on replica A's own connection is received by replica B's subscription", async () => {
    const receivedOnB: SsoRegistrySyncMessage[] = [];
    await replicaB.onMessage((message) => receivedOnB.push(message));

    await replicaA.publish({ companyId: 'acme', action: 'register' });

    await waitFor(() => receivedOnB.length > 0);
    expect(receivedOnB).toEqual([{ companyId: 'acme', action: 'register' }]);
  });

  it("a publish on replica A is ALSO received on A's own subscription (Redis pub/sub echoes to the publisher)", async () => {
    // The exact real-infrastructure fact `sso-registrar.service.ts`'s own "self-echo" reasoning
    // depends on — proven here against a real server, not assumed.
    const receivedOnA: SsoRegistrySyncMessage[] = [];
    await replicaA.onMessage((message) => receivedOnA.push(message));

    await replicaA.publish({ companyId: 'acme', action: 'unregister' });

    await waitFor(() => receivedOnA.length > 0);
    expect(receivedOnA).toEqual([{ companyId: 'acme', action: 'unregister' }]);
  });

  it('delivers to every replica listening, not just one', async () => {
    const replicaC = new SsoRegistrySyncService();
    try {
      const receivedOnB: SsoRegistrySyncMessage[] = [];
      const receivedOnC: SsoRegistrySyncMessage[] = [];
      await replicaB.onMessage((message) => receivedOnB.push(message));
      await replicaC.onMessage((message) => receivedOnC.push(message));

      await replicaA.publish({ companyId: 'globex', action: 'register' });

      await waitFor(() => receivedOnB.length > 0 && receivedOnC.length > 0);
      expect(receivedOnB).toEqual([{ companyId: 'globex', action: 'register' }]);
      expect(receivedOnC).toEqual([{ companyId: 'globex', action: 'register' }]);
    } finally {
      await replicaC.onModuleDestroy();
    }
  });
});
