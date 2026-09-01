/**
 * `peppol-status-poller.ts` in isolation — same style `pdp-status-poller.ts` presumably will get once
 * it grows its own dedicated spec, and the same `channelCredentials` mock shape
 * `ksef-status-poller.spec.ts` already established.
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError } from '../authority-status-poller';
import { buildPeppolStatusPoller, PEPPOL_PROVIDER_ID } from './peppol-status-poller';

const mockGetStatus = jest.fn();

jest.mock('../../transports/peppol/peppol-client', () => ({
  PeppolApHttpClient: jest.fn().mockImplementation(() => ({ getStatus: mockGetStatus })),
}));

const CONNECTED_CONFIG = {
  providerId: 'peppol',
  channel: 'PEPPOL',
  environment: 'TEST' as const,
  isActive: true,
  config: { accessPointUrl: 'http://127.0.0.1:1', apiKey: 'ap-key', participantId: '0009:11112222' },
};

function buildDeps(resolveActive: jest.Mock) {
  return { channelCredentials: { resolveActive } as unknown as ChannelCredentialsService };
}

describe('buildPeppolStatusPoller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('carries the transport registry\'s own "peppol" provider id', () => {
    const poller = buildPeppolStatusPoller(buildDeps(jest.fn()));
    expect(poller.providerId).toBe(PEPPOL_PROVIDER_ID);
    expect(poller.providerId).toBe('peppol');
  });

  describe('isTerminal', () => {
    const poller = buildPeppolStatusPoller(buildDeps(jest.fn()));
    it.each(['DELIVERED', 'FAILED'])('%s is terminal', (code) => {
      expect(poller.isTerminal(code)).toBe(true);
    });
    it.each(['QUEUED', 'SENT', 'UNKNOWN'])('%s is NOT terminal — still being polled', (code) => {
      expect(poller.isTerminal(code)).toBe(false);
    });
  });

  describe('poll()', () => {
    it('throws ChannelNotConnectedError when this company has no usable Peppol credentials', async () => {
      const poller = buildPeppolStatusPoller(buildDeps(jest.fn().mockResolvedValue(null)));
      await expect(poller.poll('company-1', 'msg-1')).rejects.toBeInstanceOf(ChannelNotConnectedError);
    });

    it('journals the CURRENT status as one event — never invents a full timeline the AP does not expose', async () => {
      mockGetStatus.mockResolvedValue({ messageId: 'msg-1', status: 'SENT' });
      const poller = buildPeppolStatusPoller(buildDeps(jest.fn().mockResolvedValue(CONNECTED_CONFIG)));

      const events = await poller.poll('company-1', 'msg-1');

      expect(events).toHaveLength(1);
      expect(events[0].statusCode).toBe('SENT');
      expect(mockGetStatus).toHaveBeenCalledWith('msg-1');
    });

    it('carries the reason through on a FAILED status', async () => {
      mockGetStatus.mockResolvedValue({
        messageId: 'msg-1',
        status: 'FAILED',
        mlrDescription: 'invalid receiver',
      });
      const poller = buildPeppolStatusPoller(buildDeps(jest.fn().mockResolvedValue(CONNECTED_CONFIG)));

      const events = await poller.poll('company-1', 'msg-1');

      expect(events[0].statusCode).toBe('FAILED');
      expect(events[0].reason).toBe('invalid receiver');
    });

    it('never carries a reason on a non-FAILED status, even if the AP happened to send an mlrDescription', async () => {
      mockGetStatus.mockResolvedValue({ messageId: 'msg-1', status: 'DELIVERED', mlrDescription: 'ignored' });
      const poller = buildPeppolStatusPoller(buildDeps(jest.fn().mockResolvedValue(CONNECTED_CONFIG)));

      const events = await poller.poll('company-1', 'msg-1');

      expect(events[0].statusCode).toBe('DELIVERED');
      expect(events[0].reason).toBeUndefined();
    });
  });
});
