/**
 * `buildPdpStatusPoller` in isolation — `PdpClient` is mocked (the real HTTP round-trip is
 * `pdp-conformity.live.spec.ts`'s job, gated on real sandbox credentials). The fixtures below are the
 * ACTUAL raw payloads captured LIVE this session (`pdp-conformity.live.spec.ts`, 2026-09-01) — deposit
 * 397536 (accepted, fr:200→201→202) and deposit 397548 (rejected, fr:213, real BR-FR-05/BT-22 reason)
 * — pasted verbatim, not invented.
 *
 * THE MUTATION TARGET this file exists to catch (this task's own brief, and `pdp-client.ts`'s own
 * header): reading `invoice.status_code` instead of `invoice.events[]`. Every fixture below has NO
 * top-level `status_code` field at all — exactly what the real superpdp API actually returns (VERIFIED
 * live, see `pdp-client.ts`'s own comment on `SuperPdpInvoice.status_code`) — so a poller mistakenly
 * reading that field would get `undefined` and produce EMPTY results, failing every assertion here
 * that expects populated events.
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { SuperPdpInvoice } from '../../transports/pdp/pdp-client';
import { ChannelNotConnectedError } from '../authority-status-poller';
import {
  buildPdpStatusPoller,
  PDP_ACCEPTED_STATUS_CODE,
  PDP_REJECTED_STATUS_CODE,
} from './pdp-status-poller';

const mockGetInvoice = jest.fn();
const mockAuthenticate = jest.fn();

jest.mock('../../transports/pdp/pdp-client', () => {
  const actual = jest.requireActual('../../transports/pdp/pdp-client');
  return {
    ...actual,
    PdpClient: jest.fn().mockImplementation(() => ({
      authenticate: mockAuthenticate,
      getInvoice: mockGetInvoice,
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

// REAL, session-captured (2026-09-01) — deposit id 397536, a fully compliant Factur-X. Note: NO
// top-level `status_code` at all — only `events[]` carries the lifecycle (see this file's own header).
const ACCEPTED_INVOICE_397536: SuperPdpInvoice = {
  id: 397536,
  direction: 'out',
  external_id: 'INV-LIVE-1788260400879',
  created_at: '2026-09-01T11:00:04.184701Z',
  updated_at: '2026-09-01T11:00:05.394248Z',
  processing_rule: 'B2B',
  events: [
    {
      id: 1142949,
      created_at: '2026-09-01T11:00:04.184701Z',
      status_code: 'api:uploaded',
      status_text: 'Téléversée',
    },
    {
      id: 1142952,
      created_at: '2026-09-01T11:00:05.118541Z',
      status_code: 'fr:200',
      status_text: 'Déposée (validée)',
    },
    {
      id: 1142953,
      created_at: '2026-09-01T11:00:05.118542Z',
      status_code: 'fr:201',
      status_text: 'Émise par la plateforme',
    },
    {
      id: 1142954,
      created_at: '2026-09-01T11:00:05.394248Z',
      status_code: 'fr:202',
      status_text: 'Reçue par la plateforme',
    },
  ],
} as SuperPdpInvoice;

// REAL, session-captured (2026-09-01) — deposit id 397548, a Factur-X deliberately built without its
// BG-1 mentions (the exact "reason" text is what superpdp's own sandbox actually answered).
const REJECTED_REASON =
  "Element 'ram:Content' must occur exactly 1 times. at " +
  '/*:CrossIndustryInvoice.../*:IncludedNote[1]\n' +
  'BR-FR-05/BT-22 : La mention relative aux frais de recouvrement (code PMT) est absente. ' +
  'Elle est obligatoire dans les notes (BG-1).';
const REJECTED_INVOICE_397548: SuperPdpInvoice = {
  id: 397548,
  direction: 'out',
  external_id: 'INV-CONFORMITY-REJECT-1788261000000',
  created_at: '2026-09-01T11:04:57.000000Z',
  updated_at: '2026-09-01T11:04:58.000000Z',
  events: [
    {
      id: 1142980,
      created_at: '2026-09-01T11:04:57.000000Z',
      status_code: 'api:uploaded',
      status_text: 'Téléversée',
    },
    {
      id: 1142981,
      created_at: '2026-09-01T11:04:58.000000Z',
      status_code: 'fr:213',
      status_text: 'Rejetée',
      data: { reason: REJECTED_REASON },
    },
  ],
} as SuperPdpInvoice;

describe('buildPdpStatusPoller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps the REAL fr:200→201→202 lifecycle from events[] — the accepted path', async () => {
    mockGetInvoice.mockResolvedValue(ACCEPTED_INVOICE_397536);
    const poller = buildPdpStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '397536');

    expect(events).toHaveLength(4);
    expect(events.map((e) => e.statusCode)).toEqual(['api:uploaded', 'fr:200', 'fr:201', 'fr:202']);
    expect(events[3]).toMatchObject({
      statusCode: 'fr:202',
      statusText: 'Reçue par la plateforme',
      reason: undefined,
    });
    expect(events[3].observedAt).toEqual(new Date('2026-09-01T11:00:05.394248Z'));
    // The raw payload is kept verbatim — never re-derived (this file's own header on why).
    expect(events[3].rawPayload).toEqual(ACCEPTED_INVOICE_397536.events![3]);
  });

  it('maps the REAL fr:213 rejection, with its own reason, from events[] — the rejected path', async () => {
    mockGetInvoice.mockResolvedValue(REJECTED_INVOICE_397548);
    const poller = buildPdpStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '397548');

    expect(events.map((e) => e.statusCode)).toEqual(['api:uploaded', 'fr:213']);
    const rejection = events[1];
    expect(rejection.statusCode).toBe('fr:213');
    expect(rejection.reason).toContain('BG-1');
    expect(rejection.reason).toContain('BR-FR-05/BT-22');
  });

  it(
    'THE MUTATION PROOF: calling getInvoice with an object that has events but no top-level status_code ' +
      'still yields events — reading `invoice.status_code` instead would silently return nothing',
    async () => {
      // `ACCEPTED_INVOICE_397536` (like every real superpdp response — see this file's own header) has
      // NO `status_code` field at all. If the poller's own mapping were mutated to read
      // `invoice.status_code` instead of `invoice.events`, this assertion (and every one above it)
      // would fail: `invoice.status_code` is `undefined` for this exact, real fixture.
      expect((ACCEPTED_INVOICE_397536 as { status_code?: unknown }).status_code).toBeUndefined();
      mockGetInvoice.mockResolvedValue(ACCEPTED_INVOICE_397536);
      const poller = buildPdpStatusPoller({ channelCredentials: buildChannelCredentials() });
      const events = await poller.poll('company-1', '397536');
      expect(events.length).toBeGreaterThan(0);
    },
  );

  it('an invoice with no events yet yields an empty array (nothing to journal this pass)', async () => {
    mockGetInvoice.mockResolvedValue({ ...ACCEPTED_INVOICE_397536, events: [] });
    const poller = buildPdpStatusPoller({ channelCredentials: buildChannelCredentials() });
    expect(await poller.poll('company-1', '397536')).toEqual([]);
  });

  it('throws ChannelNotConnectedError when PDP has no connected credentials for this company', async () => {
    const poller = buildPdpStatusPoller({
      channelCredentials: buildChannelCredentials(jest.fn().mockResolvedValue(null)),
    });
    await expect(poller.poll('company-1', '397536')).rejects.toBeInstanceOf(ChannelNotConnectedError);
    expect(mockGetInvoice).not.toHaveBeenCalled(); // never even reaches the network call
  });

  it('throws ChannelNotConnectedError for an incomplete config too (e.g. missing clientSecret)', async () => {
    const incomplete = { ...CONNECTED_CONFIG, config: { baseUrl: 'https://api.superpdp.tech' } };
    const poller = buildPdpStatusPoller({
      channelCredentials: buildChannelCredentials(jest.fn().mockResolvedValue(incomplete)),
    });
    await expect(poller.poll('company-1', '397536')).rejects.toBeInstanceOf(ChannelNotConnectedError);
  });

  describe('isTerminal', () => {
    const poller = buildPdpStatusPoller({ channelCredentials: buildChannelCredentials() });

    it('fr:202 (accepted) and fr:213 (rejected) are terminal', () => {
      expect(poller.isTerminal(PDP_ACCEPTED_STATUS_CODE)).toBe(true);
      expect(poller.isTerminal(PDP_REJECTED_STATUS_CODE)).toBe(true);
    });

    it('every intermediate/unknown code is NOT terminal', () => {
      expect(poller.isTerminal('fr:200')).toBe(false);
      expect(poller.isTerminal('fr:201')).toBe(false);
      expect(poller.isTerminal('api:uploaded')).toBe(false);
      expect(poller.isTerminal('poll:blocked')).toBe(false);
    });
  });
});
