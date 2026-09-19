import { vi, type Mock } from 'vitest';

import { BILLING_FLAG_NAME } from '../modules/billing/billing-flag';
import { LegalReleaseBootService } from './legal-release-boot.service';
import { detectAndRecordNewLegalReleases } from './legal-release-detection';
import { createLegalReleaseLockRedisClient, withLegalReleaseNotifyLock } from './legal-release-lock';
import { notifyUsersOfLegalReleases } from './legal-release-notify';

vi.mock('./legal-release-detection');
vi.mock('./legal-release-notify');
// The lock's OWN behaviour (mutual exclusion, TTL-based crash recovery) is
// `legal-release-lock.spec.ts`'s job, against a fake in-memory Redis. Mocked here, the same way
// `./legal-release-detection`/`./legal-release-notify` already are, so THIS file never opens a real
// Redis connection: `createLegalReleaseLockRedisClient` would otherwise construct a genuine `ioredis`
// client the moment `onModuleInit` runs.
vi.mock('./legal-release-lock');

const detect = detectAndRecordNewLegalReleases as Mock;
const notify = notifyUsersOfLegalReleases as Mock;
const createLockClient = createLegalReleaseLockRedisClient as Mock;
const withLock = withLegalReleaseNotifyLock as Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

function fakeMailService() {
  return { sendMail: vi.fn() } as unknown as import('@/mail/mail.service').MailService;
}

const tosDoc = { slug: 'terms-of-service', title: 'Terms of Service', version: '2026-09-17' } as never;

beforeEach(() => {
  detect.mockReset();
  notify.mockReset().mockResolvedValue({ releasesProcessed: 1, usersNotified: 0, usersFailed: 0 });
  createLockClient.mockReset().mockReturnValue({ disconnect: vi.fn() });
  // Default: the lock is free — runs `fn` (the real call site's own `() =>
  // notifyUsersOfLegalReleases(...)`) immediately and returns its result, standing in for "this
  // replica won the cluster-wide lock" without any real Redis involved.
  withLock.mockReset().mockImplementation((_client: unknown, fn: () => Promise<unknown>) => fn());
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
  else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
});

describe('LegalReleaseBootService.onModuleInit', () => {
  it('never notifies when nothing changed, regardless of SaaS mode', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [], changed: [] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(notify).not.toHaveBeenCalled();
  });

  it('never notifies a bootstrap-only release, even in SaaS mode', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [tosDoc], changed: [] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(notify).not.toHaveBeenCalled();
  });

  it('kicks off notification for a real change in SaaS mode', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('records the release but sends NO mail outside SaaS mode', async () => {
    delete process.env[BILLING_FLAG_NAME];
    detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(detect).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('never throws when detection itself fails', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockRejectedValue(new Error('DB unreachable'));

    await expect(new LegalReleaseBootService(fakeMailService()).onModuleInit()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not let a rejected notification pass escape onModuleInit', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });
    notify.mockRejectedValue(new Error('mail provider down'));

    await expect(new LegalReleaseBootService(fakeMailService()).onModuleInit()).resolves.toBeUndefined();
  });

  /**
   * The actual fix under test here: the notification pass runs THROUGH the cross-replica lock,
   * never as a bare call to `notifyUsersOfLegalReleases`. A regression that skipped the lock entirely
   * (called `notifyUsersOfLegalReleases` directly again) would leave `withLock` uncalled here.
   */
  describe('cross-replica lock', () => {
    it('runs the notification pass THROUGH withLegalReleaseNotifyLock, not directly', async () => {
      process.env[BILLING_FLAG_NAME] = 'true';
      detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });

      await new LegalReleaseBootService(fakeMailService()).onModuleInit();

      expect(withLock).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('never crashes when another replica already holds the lock (withLock resolves undefined)', async () => {
      process.env[BILLING_FLAG_NAME] = 'true';
      detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });
      // Standing in for "the lock is held elsewhere" — the real `withLegalReleaseNotifyLock` resolves
      // to `undefined` without ever calling `fn` in that case (see its own spec).
      withLock.mockResolvedValue(undefined);

      await expect(new LegalReleaseBootService(fakeMailService()).onModuleInit()).resolves.toBeUndefined();
    });

    it('opens the lock Redis client and disconnects it once the pass settles, on success', async () => {
      process.env[BILLING_FLAG_NAME] = 'true';
      detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });
      const disconnect = vi.fn();
      createLockClient.mockReturnValue({ disconnect });

      const service = new LegalReleaseBootService(fakeMailService());
      await service.onModuleInit();
      // The lock/notify chain itself is fire-and-forget (see this service's own header) — give its
      // own `.then()/.finally()` a turn to run before checking cleanup happened.
      await new Promise((resolve) => setImmediate(resolve));

      expect(createLockClient).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects the lock client even when the notification pass itself rejects outright', async () => {
      process.env[BILLING_FLAG_NAME] = 'true';
      detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });
      const disconnect = vi.fn();
      createLockClient.mockReturnValue({ disconnect });
      withLock.mockRejectedValue(new Error('lock Redis unreachable'));

      const service = new LegalReleaseBootService(fakeMailService());
      await service.onModuleInit();
      await new Promise((resolve) => setImmediate(resolve));

      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
