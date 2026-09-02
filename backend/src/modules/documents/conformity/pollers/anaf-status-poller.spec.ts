/**
 * `anaf-status-poller.ts` in isolation — same style `peppol-status-poller.spec.ts`/
 * `chorus-pro-status-poller.ts`'s own (unwritten yet) sibling would hold: `AnafClient` is mocked
 * wholesale (the real HTTP round-trip is `transports/anaf/anaf-client.spec.ts`'s job), this proves the
 * MAPPING — `stareMesaj` → `RawAuthorityEvent`, terminal vs not, ok AND nok alike (this task's own
 * mutation #2 target: a poller that called every `stare` "ok" would pass a naive smoke test forever).
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError } from '../authority-status-poller';
import { buildAnafStatusPoller, ANAF_PROVIDER_ID } from './anaf-status-poller';

const mockGetStatus = jest.fn();

jest.mock('../../transports/anaf/anaf-client', () => {
  const actual = jest.requireActual('../../transports/anaf/anaf-client');
  return {
    ...actual,
    AnafClient: jest.fn().mockImplementation(() => ({ getStatus: mockGetStatus })),
  };
});

const CONNECTED_CONFIG = {
  providerId: 'anaf',
  channel: 'ANAF',
  environment: 'TEST' as const,
  isActive: true,
  config: { cif: '12345678', clientId: 'id-1', clientSecret: 'secret-1', refreshToken: 'refresh-1' },
};

function buildDeps(resolveActive: jest.Mock) {
  return { channelCredentials: { resolveActive } as unknown as ChannelCredentialsService };
}

describe('buildAnafStatusPoller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('carries the transport registry\'s own "anaf" provider id', () => {
    const poller = buildAnafStatusPoller(buildDeps(jest.fn()));
    expect(poller.providerId).toBe(ANAF_PROVIDER_ID);
    expect(poller.providerId).toBe('anaf');
  });

  describe('isTerminal', () => {
    const poller = buildAnafStatusPoller(buildDeps(jest.fn()));
    it.each(['ok', 'OK', 'nok', 'NOK', 'XML cu erori neprelucrat'])('%s is terminal', (code) => {
      expect(poller.isTerminal(code)).toBe(true);
    });
    it.each(['in prelucrare', 'some_new_status'])('%s is NOT terminal — still being polled', (code) => {
      expect(poller.isTerminal(code)).toBe(false);
    });
  });

  describe('poll()', () => {
    it('throws ChannelNotConnectedError when this company has no usable ANAF credentials', async () => {
      const poller = buildAnafStatusPoller(buildDeps(jest.fn().mockResolvedValue(null)));
      await expect(poller.poll('company-1', '5000000001')).rejects.toBeInstanceOf(ChannelNotConnectedError);
    });

    it('journals an "ok" stareMesaj as a CLEARED-mapping, terminal event, with no reason', async () => {
      mockGetStatus.mockResolvedValue({ stare: 'ok', errors: [], raw: '<header stare="ok"/>' });
      const poller = buildAnafStatusPoller(buildDeps(jest.fn().mockResolvedValue(CONNECTED_CONFIG)));

      const events = await poller.poll('company-1', '5000000001');

      expect(events).toHaveLength(1);
      expect(events[0].statusCode).toBe('ok');
      expect(poller.isTerminal(events[0].statusCode)).toBe(true);
      expect(events[0].reason).toBeUndefined();
      expect(mockGetStatus).toHaveBeenCalledWith('5000000001');
    });

    it('journals a still-processing "in prelucrare" as NOT terminal, with no reason', async () => {
      mockGetStatus.mockResolvedValue({ stare: 'in prelucrare', errors: [], raw: '<header/>' });
      const poller = buildAnafStatusPoller(buildDeps(jest.fn().mockResolvedValue(CONNECTED_CONFIG)));

      const events = await poller.poll('company-1', '5000000001');

      expect(events[0].statusCode).toBe('in prelucrare');
      expect(poller.isTerminal(events[0].statusCode)).toBe(false);
      expect(events[0].reason).toBeUndefined();
    });

    // THE MUTATION TARGET (#2 in the task brief): "nok" must be journaled as TERMINAL and REJECTED,
    // carrying the authority's own errors — a poller that answered "ok" (or "not terminal") regardless
    // of the real `stare` would leave a rejected invoice polled forever, silently, never surfaced.
    it('carries the authority\'s own errors through on a "nok" — terminal, with a real reason', async () => {
      mockGetStatus.mockResolvedValue({
        stare: 'nok',
        errors: ['Buyer VAT identifier missing', 'BR-CO-15'],
        raw: '<header stare="nok"><Errors errorMessage="Buyer VAT identifier missing"/></header>',
      });
      const poller = buildAnafStatusPoller(buildDeps(jest.fn().mockResolvedValue(CONNECTED_CONFIG)));

      const events = await poller.poll('company-1', '5000000001');

      expect(events[0].statusCode).toBe('nok');
      expect(poller.isTerminal(events[0].statusCode)).toBe(true);
      expect(events[0].reason).toBe('Buyer VAT identifier missing; BR-CO-15');
    });

    it('falls back to the raw stare as the reason on a "nok" with no Errors at all', async () => {
      mockGetStatus.mockResolvedValue({ stare: 'nok', errors: [], raw: '<header stare="nok"/>' });
      const poller = buildAnafStatusPoller(buildDeps(jest.fn().mockResolvedValue(CONNECTED_CONFIG)));

      const events = await poller.poll('company-1', '5000000001');
      expect(events[0].reason).toBe('nok');
    });
  });
});
