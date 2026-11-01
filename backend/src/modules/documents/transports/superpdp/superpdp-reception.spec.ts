import { vi, type Mock } from 'vitest';
import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { SuperPdpApiError } from './superpdp-client';
import {
  buildSuperPdpReceptionStatusPusher,
  PDP_RECEPTION_APPROVED_CODE,
  PDP_RECEPTION_PAID_CODE,
  PDP_RECEPTION_REJECTED_CODE,
  PDP_RECEPTION_REJECTED_REASON_CODE,
  PDP_RECEPTION_TAKEN_IN_CHARGE_CODE,
} from './superpdp-reception';

// The real logger persists to Prisma, which a unit test must not need at all (and which fails
// noisily without a database); the push's own visibility contract is what is asserted instead.
vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockPushLifecycleStatus = vi.fn();
const mockAuthenticate = vi.fn();
const mockLoggerError = logger.error as Mock;

vi.mock('./superpdp-client', async () => {
  // `vi.importActual` is ASYNC (unlike Jest's synchronous `requireActual`) — the factory MUST be
  // `async` and this MUST be `await`ed, or `...actual` spreads a Promise's own (empty) enumerable
  // properties instead of the real module's exports, silently discarding every real export.
  const actual = await vi.importActual('./superpdp-client');
  return {
    ...actual,
    // A `function` expression, NOT an arrow function - production code does `new SuperPdpClient(...)`
    // (`superpdp-reception.ts`'s own client builder). Jest's mocks never really `[[Construct]]` their
    // implementation (they call it plainly and use the return value), so an arrow function "worked"
    // there; Vitest's mocks DO construct it for real, and an arrow function has no `[[Construct]]` at
    // all — "TypeError: ... is not a constructor".
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression - an arrow function has no [[Construct]] and breaks `new SuperPdpClient(...)` under Vitest, see above.
    SuperPdpClient: vi.fn().mockImplementation(function () {
      return { authenticate: mockAuthenticate, pushLifecycleStatus: mockPushLifecycleStatus };
    }),
  };
});

const CONNECTED_CONFIG = {
  providerId: 'pdp',
  channel: 'PDP',
  environment: 'TEST' as const,
  isActive: true,
  config: { baseUrl: 'https://api.superpdp.tech', clientId: 'id-1', clientSecret: 'secret-1' },
};

function buildChannelCredentials(resolveActive = vi.fn().mockResolvedValue(CONNECTED_CONFIG)) {
  return { resolveActive } as unknown as ChannelCredentialsService;
}

describe('buildSuperPdpReceptionStatusPusher', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pushTakenInCharge pushes the "prise en charge" code', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildSuperPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushTakenInCharge('company-1', '604667');

    expect(mockPushLifecycleStatus).toHaveBeenCalledWith(
      604667,
      PDP_RECEPTION_TAKEN_IN_CHARGE_CODE,
      undefined,
    );
  });

  it('pushApproved pushes the "accepted by buyer" code', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildSuperPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushApproved('company-1', '604667');

    expect(mockPushLifecycleStatus).toHaveBeenCalledWith(604667, PDP_RECEPTION_APPROVED_CODE, undefined);
  });

  it('pushRejected pushes the "refusée" code with a ReasonCode and the user text as the motivation', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildSuperPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushRejected('company-1', '604667', 'Wrong PO');

    expect(mockPushLifecycleStatus).toHaveBeenCalledWith(604667, PDP_RECEPTION_REJECTED_CODE, {
      reasonCode: PDP_RECEPTION_REJECTED_REASON_CODE,
      motivation: 'Wrong PO',
    });
  });

  it('pushPaid pushes "payment sent" (this company IS the buyer here) — fr:211, not fr:212', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildSuperPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushPaid('company-1', '604667');

    expect(mockPushLifecycleStatus).toHaveBeenCalledWith(604667, PDP_RECEPTION_PAID_CODE, undefined);
  });

  it('never throws when the platform push fails, and logs it at error with the platform status and body', async () => {
    mockPushLifecycleStatus.mockRejectedValue(
      new SuperPdpApiError(
        'Validation failed',
        400,
        { http_status_code: 400, error: 'invalid reason' },
        '/v1.beta/invoice_events',
      ),
    );
    const pusher = buildSuperPdpReceptionStatusPusher(buildChannelCredentials());

    await expect(pusher.pushRejected('company-1', '604667', 'Wrong PO')).resolves.toBeUndefined();

    expect(mockLoggerError).toHaveBeenCalledWith(
      'SuperPDP reception status push failed: the platform did not receive it',
      expect.objectContaining({
        category: 'documents',
        details: expect.objectContaining({
          companyId: 'company-1',
          pdpInboundId: '604667',
          code: PDP_RECEPTION_REJECTED_CODE,
          reason: 'Wrong PO',
          reasonCode: PDP_RECEPTION_REJECTED_REASON_CODE,
          status: 400,
          response: { http_status_code: 400, error: 'invalid reason' },
          message: expect.stringContaining('PDP /v1.beta/invoice_events: 400'),
        }),
      }),
    );
  });

  it('does not log at error when the push succeeds', async () => {
    mockPushLifecycleStatus.mockResolvedValue(undefined);
    const pusher = buildSuperPdpReceptionStatusPusher(buildChannelCredentials());

    await pusher.pushPaid('company-1', '604667');

    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('is a silent no-op (never even resolves a client) when PDP is not connected for this company', async () => {
    const pusher = buildSuperPdpReceptionStatusPusher(
      buildChannelCredentials(vi.fn().mockResolvedValue(null)),
    );

    await pusher.pushApproved('company-1', '604667');

    expect(mockPushLifecycleStatus).not.toHaveBeenCalled();
  });

  it('is a silent no-op for a non-numeric pdpInboundId (a manually-uploaded received-invoice has none)', async () => {
    const channelCredentials = buildChannelCredentials();
    const pusher = buildSuperPdpReceptionStatusPusher(channelCredentials);

    await pusher.pushApproved('company-1', 'not-a-number');

    expect(channelCredentials.resolveActive as Mock).not.toHaveBeenCalled();
    expect(mockPushLifecycleStatus).not.toHaveBeenCalled();
  });
});
