/**
 * `buildPdpReceptionPoller` in isolation — `PdpClient` is mocked (the real HTTP round-trip is
 * `superpdp-reception.live.spec.ts`'s job). `listInvoices({direction:'in'})`'s own response shape below is
 * the ACTUAL raw payload captured LIVE (2026-09-16, self-addressed sandbox deposit — see
 * `pdp-reception.ts`'s own header), pasted verbatim.
 */
import { vi } from 'vitest';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { buildPdpReceptionPoller, RECEPTION_MAX_PAGES, RECEPTION_PAGE_SIZE } from './pdp-reception-poller';

const mockListInvoices = vi.fn();
const mockDownloadInvoiceFile = vi.fn();
const mockAuthenticate = vi.fn();

vi.mock('../../transports/pdp/pdp-client', async () => {
  const actual = await vi.importActual('../../transports/pdp/pdp-client');
  return {
    ...actual,
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression — an arrow function has no [[Construct]] and breaks `new PdpClient(...)` under Vitest (Jest's own mock never actually invoked [[Construct]], so an arrow function silently "worked" there).
    PdpClient: vi.fn().mockImplementation(function () {
      return {
        authenticate: mockAuthenticate,
        listInvoices: mockListInvoices,
        downloadInvoiceFile: mockDownloadInvoiceFile,
      };
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

// REAL, captured live (2026-09-16) — a self-addressed sandbox deposit's own "in" twin.
const INBOUND_LIST_RESPONSE = {
  data: [{ id: 604667, company_id: 1422, created_at: '2026-09-16T14:43:43.527908Z', direction: 'in' }],
  count: 1,
  has_before: false,
  has_after: false,
};

// A minimal, valid EN 16931 CII fragment — enough for `extraction.ts`'s own namespace-agnostic reader
// to pull `supplier`/`currency` out of, proving THIS module's wiring (download -> extract), not
// extraction.ts's own field-by-field correctness (that is extraction.spec.ts's job).
const MINIMAL_CII_XML = Buffer.from(
  `<?xml version="1.0"?>
  <rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
    <rsm:ExchangedDocument><ram:ID>SUP-INV-42</ram:ID></rsm:ExchangedDocument>
    <ram:SellerTradeParty><ram:Name>Acme Supplies</ram:Name></ram:SellerTradeParty>
    <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
  </rsm:CrossIndustryInvoice>`,
  'utf-8',
);

describe('buildPdpReceptionPoller', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('listInbound', () => {
    it('lists every inbound deposit for a connected company (direction=in)', async () => {
      mockListInvoices.mockResolvedValue(INBOUND_LIST_RESPONSE);
      const poller = buildPdpReceptionPoller({ channelCredentials: buildChannelCredentials() });

      const inbound = await poller.listInbound('company-1');

      expect(mockListInvoices).toHaveBeenCalledWith({
        direction: 'in',
        order: 'asc',
        limit: 100,
        startingAfterId: undefined,
      });
      expect(inbound).toEqual(INBOUND_LIST_RESPONSE.data);
    });

    // Answers like the real endpoint: ascending ids, `limit` per page, `starting_after_id` cursor.
    function fakeInbox(total: number) {
      const ids = Array.from({ length: total }, (_, i) => i + 1);
      mockListInvoices.mockImplementation(
        async (opts: { order?: string; limit?: number; startingAfterId?: number }) => {
          const sorted = opts.order === 'desc' ? [...ids].reverse() : ids;
          const after = sorted.filter(
            (id) => opts.startingAfterId === undefined || id > opts.startingAfterId,
          );
          const page = after.slice(0, opts.limit ?? 100);
          return {
            data: page.map((id) => ({ id, direction: 'in' })),
            count: total,
            has_before: false,
            has_after: after.length > page.length,
          };
        },
      );
    }

    it('returns a new deposit that sits beyond the first page of a long inbox', async () => {
      fakeInbox(120);
      const poller = buildPdpReceptionPoller({ channelCredentials: buildChannelCredentials() });

      const inbound = await poller.listInbound('company-1', 110);

      expect(inbound.map((d) => d.id)).toEqual([111, 112, 113, 114, 115, 116, 117, 118, 119, 120]);
    });

    it('walks every page when nothing was imported yet, up to its per-pass bound', async () => {
      fakeInbox(250);
      const poller = buildPdpReceptionPoller({ channelCredentials: buildChannelCredentials() });

      const all = await poller.listInbound('company-1');
      expect(all.map((d) => d.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));

      fakeInbox(RECEPTION_PAGE_SIZE * RECEPTION_MAX_PAGES + 5);
      const bounded = await poller.listInbound('company-1');
      expect(bounded).toHaveLength(RECEPTION_PAGE_SIZE * RECEPTION_MAX_PAGES);
    });

    it('returns an EMPTY array (never throws) when PDP is not connected for this company', async () => {
      const poller = buildPdpReceptionPoller({
        channelCredentials: buildChannelCredentials(vi.fn().mockResolvedValue(null)),
      });

      expect(await poller.listInbound('company-1')).toEqual([]);
      expect(mockListInvoices).not.toHaveBeenCalled();
    });
  });

  describe('downloadAndExtract', () => {
    it('downloads the original bytes and runs them through the SAME structural extraction the manual upload screen uses', async () => {
      mockDownloadInvoiceFile.mockResolvedValue({ bytes: MINIMAL_CII_XML, contentType: 'application/xml' });
      const poller = buildPdpReceptionPoller({ channelCredentials: buildChannelCredentials() });

      const result = await poller.downloadAndExtract('company-1', 604667);

      expect(mockDownloadInvoiceFile).toHaveBeenCalledWith(604667, 'original');
      expect(result.mime).toBe('application/xml');
      expect(result.fileName).toBe('pdp-inbound-604667.xml');
      expect(result.extraction.syntax).toBe('CII');
      expect(result.extraction.fields.supplier).toBe('Acme Supplies');
      expect(result.extraction.fields.supplierNumber).toBe('SUP-INV-42');
      expect(result.extraction.fields.currency).toBe('EUR');
    });

    it('throws (never silently returns empty) when PDP is not connected for this company', async () => {
      const poller = buildPdpReceptionPoller({
        channelCredentials: buildChannelCredentials(vi.fn().mockResolvedValue(null)),
      });

      await expect(poller.downloadAndExtract('company-1', 604667)).rejects.toThrow(/not connected/);
      expect(mockDownloadInvoiceFile).not.toHaveBeenCalled();
    });
  });

  it('providerId is "pdp" — the same id `transports/transport-registry.ts` already uses for delivery', () => {
    const poller = buildPdpReceptionPoller({ channelCredentials: buildChannelCredentials() });
    expect(poller.providerId).toBe('pdp');
  });
});
