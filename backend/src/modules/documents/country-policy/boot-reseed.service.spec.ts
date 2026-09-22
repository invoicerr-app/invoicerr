import { vi, type Mock } from 'vitest';

import * as bootReseed from './boot-reseed';
import { BOOT_RESEED_MAX_ATTEMPTS, CountryPolicyBootReseedService } from './boot-reseed.service';

vi.mock('@/prisma/prisma.service', () => ({ __esModule: true, default: {} }));
vi.mock('./boot-reseed');

const IN_SYNC_SUMMARY = {
  drift: { inSync: true, addedCountries: [], changedCountries: [], removedCountries: [] },
  upserted: 0,
  deleted: 0,
  reseeded: false,
};

const RESEEDED_SUMMARY = {
  drift: { inSync: false, addedCountries: ['FR'], changedCountries: [], removedCountries: [] },
  upserted: 3,
  deleted: 0,
  reseeded: true,
};

/**
 * THE MUTATION TARGET: before this, a SINGLE failed `detectAndReseedCountryPolicyDrift` call (a
 * concurrent P2002, a P2028 timeout, a momentary connection blip) left the table half-seeded until
 * "a later boot" — no self-healing within the same process. These tests prove the retry actually
 * retries (never on the FIRST, successful attempt — that would waste a boot on every ordinary start),
 * self-heals a transient failure within the SAME boot, and still never throws out of `onModuleInit`
 * once every attempt is genuinely exhausted (the pre-existing, load-bearing guarantee this service's
 * own header already documents).
 */
describe('CountryPolicyBootReseedService — bounded retry on a transient failure', () => {
  afterEach(() => vi.resetAllMocks());

  it('a successful first attempt never retries at all', async () => {
    (bootReseed.detectAndReseedCountryPolicyDrift as Mock).mockResolvedValue(IN_SYNC_SUMMARY);
    const service = new CountryPolicyBootReseedService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(bootReseed.detectAndReseedCountryPolicyDrift).toHaveBeenCalledTimes(1);
  });

  it('a TRANSIENT failure on the first attempt self-heals on the second, within the SAME boot', async () => {
    (bootReseed.detectAndReseedCountryPolicyDrift as Mock)
      .mockRejectedValueOnce(new Error('P2028: transaction timeout'))
      .mockResolvedValueOnce(RESEEDED_SUMMARY);
    const service = new CountryPolicyBootReseedService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(bootReseed.detectAndReseedCountryPolicyDrift).toHaveBeenCalledTimes(2);
  });

  it(`exhausting all ${BOOT_RESEED_MAX_ATTEMPTS} attempts still resolves without throwing — never crashes the app on a boot-time DB hiccup`, async () => {
    (bootReseed.detectAndReseedCountryPolicyDrift as Mock).mockRejectedValue(new Error('connection refused'));
    const service = new CountryPolicyBootReseedService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(bootReseed.detectAndReseedCountryPolicyDrift).toHaveBeenCalledTimes(BOOT_RESEED_MAX_ATTEMPTS);
  });
});
