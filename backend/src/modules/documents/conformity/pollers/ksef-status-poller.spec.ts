/**
 * `buildKsefStatusPoller` in isolation. Every response payload below is SYNTHETIC — labeled as such
 * deliberately, unlike `pdp-status-poller.spec.ts`'s own REAL, session-captured fixtures: NO KSeF
 * credentials are available in this checkout (`KSEF_AUTH_TOKEN` is absent — see
 * `ksef-status-poller.ts`'s own header, and `ksef-status-poller.live.spec.ts`, which SKIPS cleanly
 * for exactly that reason). These fixtures prove the MAPPING MECHANICS against the
 * `InvoiceStatusResponse` SHAPE this codebase's own `ksef-client.ts` declares — never a claim that
 * KSeF's real sandbox actually answers these exact numbers for this exact endpoint.
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { InvoiceStatusResponse } from '../../transports/ksef/ksef-client';
import { ChannelNotConnectedError } from '../authority-status-poller';
import { buildKsefStatusPoller } from './ksef-status-poller';

const mockInvoiceStatus = jest.fn();
const mockAuthenticate = jest.fn().mockResolvedValue('fresh-access-token');

jest.mock('../../transports/ksef-transport', () => {
  const actual = jest.requireActual('../../transports/ksef-transport');
  return { ...actual, authenticate: (...args: unknown[]) => mockAuthenticate(...args) };
});

jest.mock('../../transports/ksef/ksef-client', () => {
  const actual = jest.requireActual('../../transports/ksef/ksef-client');
  return {
    ...actual,
    KsefClient: jest.fn().mockImplementation(() => ({
      invoiceStatus: mockInvoiceStatus,
    })),
  };
});

jest.mock('../../transports/ksef/ksef-public-keys', () => ({
  loadVendorizedKeys: jest.fn().mockReturnValue({
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

function buildChannelCredentials(resolveActive = jest.fn().mockResolvedValue(CONNECTED_CONFIG)) {
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
  beforeEach(() => jest.clearAllMocks());

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

  it('re-authenticates fresh on every poll (KSeF access tokens are short-lived)', async () => {
    mockInvoiceStatus.mockResolvedValue(syntheticStatus(100, 'processing'));
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });

    await poller.poll('company-1', 'session-1|invoice-1');
    await poller.poll('company-1', 'session-1|invoice-1');

    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  it('throws (a plain Error, never ChannelNotConnectedError) for a malformed transportRef', async () => {
    const poller = buildKsefStatusPoller({ channelCredentials: buildChannelCredentials() });
    await expect(poller.poll('company-1', 'not-a-valid-ref')).rejects.toThrow(/Malformed KSeF transportRef/);
    expect(mockInvoiceStatus).not.toHaveBeenCalled();
  });

  it('throws ChannelNotConnectedError when KSeF has no connected credentials for this company', async () => {
    const poller = buildKsefStatusPoller({
      channelCredentials: buildChannelCredentials(jest.fn().mockResolvedValue(null)),
    });
    await expect(poller.poll('company-1', 'session-1|invoice-1')).rejects.toBeInstanceOf(
      ChannelNotConnectedError,
    );
    expect(mockInvoiceStatus).not.toHaveBeenCalled();
  });
});
