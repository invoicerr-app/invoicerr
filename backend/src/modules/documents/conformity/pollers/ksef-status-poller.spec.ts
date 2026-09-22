/**
 * `buildKsefStatusPoller` in isolation. Every response payload below is SYNTHETIC — labeled as such
 * deliberately, unlike `pdp-status-poller.spec.ts`'s own REAL, session-captured fixtures: NO KSeF
 * credentials are available in this checkout (`KSEF_AUTH_TOKEN` is absent — see
 * `ksef-status-poller.ts`'s own header, and `ksef-status-poller.live.spec.ts`, which SKIPS cleanly
 * for exactly that reason). These fixtures prove the MAPPING MECHANICS against the
 * `InvoiceStatusResponse` SHAPE this codebase's own `ksef-client.ts` declares — never a claim that
 * KSeF's real sandbox actually answers these exact numbers for this exact endpoint.
 */
import { vi } from 'vitest';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { InvoiceStatusResponse } from '../../transports/ksef/ksef-client';
import { ChannelNotConnectedError } from '../authority-status-poller';
import { __resetKsefAccessTokenCacheForTests, buildKsefStatusPoller } from './ksef-status-poller';

const mockInvoiceStatus = vi.fn();
/** `expiresAt` far enough in the future that the cache (this file's own subject) actually kicks in
 *  for two immediate, back-to-back polls in the same test. */
const mockAuthenticate = vi
  .fn()
  .mockResolvedValue({ accessToken: 'fresh-access-token', expiresAt: Date.now() + 10 * 60 * 1000 });

vi.mock('../../transports/ksef-transport', async () => {
  const actual = await vi.importActual('../../transports/ksef-transport');
  return { ...actual, authenticate: (...args: unknown[]) => mockAuthenticate(...args) };
});

vi.mock('../../transports/ksef/ksef-client', async () => {
  const actual = await vi.importActual('../../transports/ksef/ksef-client');
  return {
    ...actual,
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression — an arrow function has no [[Construct]] and breaks `new KsefClient(...)` under Vitest (Jest's own mock never actually invoked [[Construct]], so an arrow function silently "worked" there).
    KsefClient: vi.fn().mockImplementation(function () {
      return { invoiceStatus: mockInvoiceStatus };
    }),
  };
});

vi.mock('../../transports/ksef/ksef-public-keys', () => ({
  loadVendorizedKeys: vi.fn().mockReturnValue({
    tokenEncryptionKeyPem: 'PEM-token',
    symmetricKeyPem: 'PEM-symmetric',
  }),
}));

const CONNECTED_CONFIG = {
  providerId: 'ksef',
  channel: 'KSeF',
  environment: 'TEST' as const,
  isActive: true,
  config: { nip: '5260001246', ksefToken: 'a-token' },
};

function buildChannelCredentials(resolveActive = vi.fn().mockResolvedValue(CONNECTED_CONFIG)) {
  return { resolveActive } as unknown as ChannelCredentialsService;
}

function syntheticStatus(code: number, description: string, details?: string[]): InvoiceStatusResponse {
  return {
    ordinalNumber: 1,
    referenceNumber: 'invoice-ref-1',
    invoiceHash: 'hash',
    invoicingDate: '2026-09-01',
    status: { code, description, details: details ?? null },
  } as InvoiceStatusResponse;
}

describe('buildKsefStatusPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      accessToken: 'fresh-access-token',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    // The cache is module-level (this file's own header) — without this, a token cached by an EARLIER
    // test would silently survive into a LATER one and make its own assertion pass for the wrong
    // reason (or fail spuriously, depending on run order).
    __resetKsefAccessTokenCacheForTests();
  });

  it('maps a "still processing" status (SYNTHETIC) to a non-terminal event', async () => {
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(100, 'W trakcie przetwarzania'));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', 'session-1|invoice-1');

    expect(events).toHaveLength(1);
    expect(events[0].statusCode).toBe('pl:100');
    expect(events[0].reason).toBeUndefined();
    expect(poller.isTerminal(events[0].statusCode)).toBe(false);
  });

  it('maps a success status (SYNTHETIC, code 200) to a terminal, accepted event', async () => {
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(200, 'Przyjęto'));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', 'session-1|invoice-1');

    expect(events[0].statusCode).toBe('pl:200');
    expect(events[0].reason).toBeUndefined();
    expect(poller.isTerminal('pl:200')).toBe(true);
  });

  it('maps an error status (SYNTHETIC, code >= 400) to a terminal, rejected event with its own reason', async () => {
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(415, 'Odrzucono', ['Niepoprawny numer NIP nabywcy']));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', 'session-1|invoice-1');

    expect(events[0].statusCode).toBe('pl:415');
    expect(events[0].reason).toContain('Odrzucono');
    expect(events[0].reason).toContain('Niepoprawny numer NIP nabywcy');
    expect(poller.isTerminal('pl:415')).toBe(true);
  });

  it('reuses ONE cached access token across several polls for the same (company, environment) — the fix for the poller rate-limiting itself', async () => {
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(100, 'processing'));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    await poller.poll('company-1', 'session-1|invoice-1');
    await poller.poll('company-1', 'session-1|invoice-2');
    await poller.poll('company-1', 'session-1|invoice-3');

    // ONE handshake (challenge + ksef-token + status + redeem) for three documents belonging to the
    // SAME company/environment — not three, which is exactly the "N documents = N handshakes" failure
    // mode this cache exists to close.
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockInvoiceStatus).toHaveBeenCalledTimes(3);
  });

  it('authenticates separately per company (never shares a token across tenants)', async () => {
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(100, 'processing'));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    await poller.poll('company-1', 'session-1|invoice-1');
    await poller.poll('company-2', 'session-1|invoice-1');

    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  // Reproduces the credential-rotation gap this cache would otherwise have: keying purely on
  // (company, environment) would keep answering polls with a token minted under credentials the
  // company has since REPLACED, for as long as that token's own TTL allows.
  it('re-authenticates when the same company/environment reconnects with a DIFFERENT KSeF token', async () => {
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(100, 'processing'));
    const resolveActive = vi
      .fn()
      .mockResolvedValueOnce({ ...CONNECTED_CONFIG, config: { nip: '5260001246', ksefToken: 'token-a' } })
      .mockResolvedValueOnce({ ...CONNECTED_CONFIG, config: { nip: '5260001246', ksefToken: 'token-b' } });
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials(resolveActive) });

    await poller.poll('company-1', 'session-1|invoice-1');
    await poller.poll('company-1', 'session-1|invoice-2');

    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it('re-authenticates once the cached token has expired', async () => {
    mockAuthenticate.mockResolvedValue({ accessToken: 'about-to-expire', expiresAt: Date.now() + 1 });
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(100, 'processing'));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    await poller.poll('company-1', 'session-1|invoice-1');
    // The cached token's `expiresAt` is already inside the poller's own 60s refresh margin by the time
    // this second call runs — a real re-authentication, not a reuse of the near-dead token.
    await poller.poll('company-1', 'session-1|invoice-2');

    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it('evicts the cached token when the status call itself fails, so the NEXT poll re-authenticates rather than retrying the same bad token', async () => {
    mockInvoiceStatus.mockRejectedValueOnce(new Error('401 Unauthorized'));
    mockInvoiceStatus.mockResolvedValueOnce(syntheticStatus(100, 'processing'));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    await expect(poller.poll('company-1', 'session-1|invoice-1')).rejects.toThrow('401 Unauthorized');
    await poller.poll('company-1', 'session-1|invoice-2');

    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it('throws (a plain Error, never ChannelNotConnectedError) for a malformed transportRef', async () => {
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });
    await expect(poller.poll('company-1', 'not-a-valid-ref')).rejects.toThrow(/Malformed KSeF transportRef/);
    expect(mockInvoiceStatus).not.toHaveBeenCalled();
  });

  it('throws ChannelNotConnectedError when KSeF has no connected credentials for this company', async () => {
    const poller = buildKsefStatusPoller({
      channelCredentials: buildChannelCredentials(vi.fn().mockResolvedValue(null)),
    });
    await expect(poller.poll('company-1', 'session-1|invoice-1')).rejects.toBeInstanceOf(
      ChannelNotConnectedError,
    );
    expect(mockInvoiceStatus).not.toHaveBeenCalled();
  });
});
