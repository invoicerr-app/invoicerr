import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import {
  buildPdpReceptionStatusPusher,
  PDP_RECEPTION_APPROVED_CODE,
  PDP_RECEPTION_PAID_CODE,
  PDP_RECEPTION_REJECTED_CODE,
  PDP_RECEPTION_TAKEN_IN_CHARGE_CODE,
} from './pdp-reception';

const mockPushLifecycleStatus = jest.fn();
const mockAuthenticate = jest.fn();

jest.mock('./pdp-client', () => {
  const actual = jest.requireActual('./pdp-client');
  return {
    ...actual,
    PdpClient: jest.fn().mockImplementation(() => ({
      authenticate: mockAuthenticate,
      pushLifecycleStatus: mockPushLifecycleStatus,
    })),
  };
});

const CONNECTED_CONFIG = {
  providerId: 'pdp',
  channel: 'PDP',
  environment: 'TEST' as const,
  isActive: true,
  config: { baseUrl: 'https://api.superpdp.tech', clientId: 'id-1', clientSecret: 'secret-1' },
};

function buildChannelCredentials(resolveActive = jest.fn().mockResolvedValue(CONNECTED_CONFIG)) {
  return { resolveActive } as unknown as ChannelCredentialsService;
}

describe('buildPdpReceptionStatusPusher', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pushTakenInCharge pushes the "prise en charge" code', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushTakenInCharge('company-1', '604667');

    expect(mockPushLifecycleStatus).toHaveBeenCalledWith(604667, PDP_RECEPTION_TAKEN_IN_CHARGE_CODE);
  });

  it('pushApproved pushes the "accepted by buyer" code', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushApproved('company-1', '604667');

    expect(mockPushLifecycleStatus).toHaveBeenCalledWith(604667, PDP_RECEPTION_APPROVED_CODE);
  });

  it(
    'pushRejected pushes the "refusée" code — the reason is not sent as a second argument (this ' +
      'client method takes only a code), consistent with pdp-client.ts#pushLifecycleStatus',
    async () => {
      mockPushLifecycleStatus.mockResolvedValue(undefined);
      const pusher = buildPdpReceptionStatusPusher(buildChannelCredentials());

      await pusher.pushRejected('company-1', '604667', 'Wrong PO');

      expect(mockPushLifecycleStatus).toHaveBeenCalledWith(604667, PDP_RECEPTION_REJECTED_CODE);
    },
  );

  it('pushPaid pushes "payment sent" (this company IS the buyer here) — fr:211, not fr:212', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushPaid('company-1', '604667');

    expect(mockPushLifecycleStatus).toHaveBeenCalledWith(604667, PDP_RECEPTION_PAID_CODE);
  });

  it('never throws when the platform push fails (LIVE-VERIFIED 404 on the sandbox, see pdp-client.ts) — non-fatal', async () => {
    mockPushLifecycleStatus.mockRejectedValue(new Error('404 Not Found'));
    const pusher = buildPdpReceptionStatusPusher(buildChannelCredentials());

    await expect(pusher.pushTakenInCharge('company-1', '604667')).resolves.toBeUndefined();
  });

  it('is a silent no-op (never even resolves a client) when PDP is not connected for this company', async () => {
    const pusher = buildPdpReceptionStatusPusher(buildChannelCredentials(jest.fn().mockResolvedValue(null)));

    await pusher.pushApproved('company-1', '604667');

    expect(mockPushLifecycleStatus).not.toHaveBeenCalled();
  });

  it('is a silent no-op for a non-numeric pdpInboundId (a manually-uploaded received-invoice has none)', async () => {
    const channelCredentials = buildChannelCredentials();
    const pusher = buildPdpReceptionStatusPusher(channelCredentials);

    await pusher.pushApproved('company-1', 'not-a-number');

    expect(channelCredentials.resolveActive as jest.Mock).not.toHaveBeenCalled();
    expect(mockPushLifecycleStatus).not.toHaveBeenCalled();
  });
});
