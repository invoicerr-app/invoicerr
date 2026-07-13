/**
 * KSeF purchase-invoice reception — end-to-end offline proof (M-6 / F-15).
 *
 * "A Polish company cannot receive the invoices where it is the buyer via KSeF" — this wires the
 * REAL pieces together (KsefInboxPort → InboxPoller → InboundInvoiceDocumentSink →
 * InboundInvoiceService, with a mocked Prisma + mocked KSeF HTTP transport, no network/DB) and
 * proves the exact VERIFY requirements:
 *   1. Querying KSeF yields N incoming (purchase) invoices → parsed + stored as received-invoices,
 *      scoped to the buyer company.
 *   2. Re-polling is deduped — no duplicate rows.
 *   3. A second company does NOT see the first company's received invoices (IDOR-sensitive scoping).
 */
import { InboxPoller } from '../lifecycle/drivers/inbox-poller';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { InMemoryCallbackStore } from '../lifecycle/drivers/inbound-job';
import { KsefInboxPort } from '../providers/transmission/ksef/ksef-inbox-port';
import {
  ActiveChannelConfig,
  ChannelCredentialsPort,
} from '../providers/transmission/channel-credentials-port';
import { HttpRequest, HttpResponse, KsefHttpClient } from '../providers/transmission/ksef/ksef-client';
import { InboundInvoiceDocumentSink } from './inbound-invoice-document-sink';
import { InboundInvoiceService } from './inbound-invoice.service';

// ---------------------------------------------------------------------------
// Mock Prisma — identical shape to inbound-invoice.service.spec.ts's makeMockPrisma().
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  const store = new Map<string, any>();
  let idSeq = 0;

  return {
    inboundInvoice: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = `${where?.channel_externalId?.channel}:${where?.channel_externalId?.externalId}`;
        return store.get(key) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `ibi_${++idSeq}`,
          ...data,
          receivedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(`${data.channel}:${data.externalId}`, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...store.values()].filter((r) => r.companyId === where.companyId),
      ),
      count: jest.fn(
        async ({ where }: any) => [...store.values()].filter((r) => r.companyId === where.companyId).length,
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const row of store.values()) {
          if (row.id === where.id && row.companyId === where.companyId) return row;
        }
        return null;
      }),
    },
    $transaction: jest.fn(async (fns: unknown[]) => {
      const results: unknown[] = [];
      for (const fn of fns) results.push(await fn);
      return results;
    }),
    _store: store,
  } as any;
}

// ---------------------------------------------------------------------------
// Mock KSeF HTTP transport (same technique as ksef-inbox-port.spec.ts).
// ---------------------------------------------------------------------------

interface FixtureInvoice {
  ksefNumber: string;
  invoiceNumber: string;
}

function fa2Xml(invoiceNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Podmiot1><DaneIdentyfikacyjne><NIP>9999999999</NIP><PelnaNazwa>Seller Sp. z o.o.</PelnaNazwa></DaneIdentyfikacyjne></Podmiot1>
  <Podmiot2><DaneIdentyfikacyjne><NIP>0000000000</NIP><PelnaNazwa>Buyer</PelnaNazwa></DaneIdentyfikacyjne></Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>2026-07-01</P_1>
    <P_2>${invoiceNumber}</P_2>
    <P_13_1>1000.00</P_13_1>
    <P_14_1>230.00</P_14_1>
    <P_15>1230.00</P_15>
  </Fa>
</Faktura>`;
}

function buildKsefHttpMock(dataByNip: Record<string, FixtureInvoice[]>) {
  let currentNip = '';
  const factory = (): KsefHttpClient => ({
    request: jest.fn(async (req: HttpRequest): Promise<HttpResponse> => {
      if (req.path.includes('/auth/challenge')) {
        return { status: 200, body: { challenge: 'C', timestamp: '', timestampMs: 1, clientIp: '1.1.1.1' } };
      }
      if (req.path.includes('/auth/ksef-token')) {
        currentNip = (req.body as { contextIdentifier: { value: string } }).contextIdentifier.value;
        return {
          status: 202,
          body: { referenceNumber: 'REF', authenticationToken: { token: 'a', validUntil: '' } },
        };
      }
      if (req.path.includes('/auth/REF')) {
        return { status: 200, body: { status: { code: 200, description: 'OK' } } };
      }
      if (req.path.includes('/auth/token/redeem')) {
        return {
          status: 200,
          body: {
            accessToken: { token: `acc-${currentNip}`, validUntil: '' },
            refreshToken: { token: 'r', validUntil: '' },
          },
        };
      }
      if (req.path.includes('/invoices/query/metadata')) {
        const fixtures = dataByNip[currentNip] ?? [];
        return {
          status: 200,
          body: {
            hasMore: false,
            isTruncated: false,
            invoices: fixtures.map((f) => ({
              ksefNumber: f.ksefNumber,
              invoiceNumber: f.invoiceNumber,
              issueDate: '2026-07-01',
              invoicingDate: '2026-07-01T10:00:00Z',
              acquisitionDate: '2026-07-01T10:01:00Z',
              permanentStorageDate: '2026-07-01T10:02:00Z',
              seller: { nip: '9999999999', name: 'Seller Sp. z o.o.' },
              buyer: { identifier: { type: 'Nip', value: currentNip }, name: 'Buyer' },
              netAmount: 1000,
              grossAmount: 1230,
              vatAmount: 230,
              currency: 'PLN',
              invoicingMode: 'Online',
              invoiceType: 'Vat',
              formCode: { systemCode: 'FA (2)', schemaVersion: '1-0E', value: 'FA' },
              isSelfInvoicing: false,
              hasAttachment: false,
              invoiceHash: 'hash==',
              thirdSubjects: [],
            })),
          },
        };
      }
      if (req.path.includes('/invoices/ksef/')) {
        const ksefNumber = decodeURIComponent(req.path.split('/invoices/ksef/')[1]);
        const fixtures = dataByNip[currentNip] ?? [];
        const found = fixtures.find((f) => f.ksefNumber === ksefNumber);
        if (!found) return { status: 404, body: {} };
        return { status: 200, body: fa2Xml(found.invoiceNumber) };
      }
      return { status: 404, body: {} };
    }),
  });
  return factory;
}

function mockCredentials(rows: ActiveChannelConfig[]): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(null),
    listActiveByProvider: jest.fn().mockResolvedValue(rows),
  };
}

function ksefConfig(companyId: string, nip: string): ActiveChannelConfig {
  return {
    companyId,
    providerId: 'ksef',
    channel: 'GOV_PORTAL_API',
    environment: 'TEST',
    config: { nip, authToken: `token-${companyId}` },
    isActive: true,
  };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('KSeF purchase-invoice reception (M-6 / F-15) — end-to-end offline', () => {
  it('two companies each poll KSeF as buyer → invoices parsed+stored scoped to the right company; re-poll dedups; no cross-tenant leak', async () => {
    const nipA = '1111111111';
    const nipB = '2222222222';

    const httpClientFactory = buildKsefHttpMock({
      [nipA]: [
        { ksefNumber: 'KSEF-A-1', invoiceNumber: 'FV/A/1' },
        { ksefNumber: 'KSEF-A-2', invoiceNumber: 'FV/A/2' },
      ],
      [nipB]: [{ ksefNumber: 'KSEF-B-1', invoiceNumber: 'FV/B/1' }],
    });

    const credentials = mockCredentials([ksefConfig('company-A', nipA), ksefConfig('company-B', nipB)]);
    const ksefPort = new KsefInboxPort({ credentials, httpClientFactory });

    const mockPrisma = makeMockPrisma();
    const inboundInvoices = new InboundInvoiceService(mockPrisma);
    const documentSink = new InboundInvoiceDocumentSink(inboundInvoices);

    const router = new InboundRouter({ applySignal: () => {}, store: new InMemoryCallbackStore() });
    const poller = new InboxPoller({ ports: [ksefPort], router, documentSink });

    // ---- First poll: 3 invoices total (2 for company-A, 1 for company-B) ----
    const report1 = await poller.tick();
    expect(report1.fetched).toBe(3);
    expect(report1.routed).toBe(3);
    expect(report1.duplicates).toBe(0);
    expect(report1.errors).toBe(0);

    const listA1 = await inboundInvoices.list('company-A');
    const listB1 = await inboundInvoices.list('company-B');
    expect(listA1.total).toBe(2);
    expect(listB1.total).toBe(1);

    // Parsed fields made it through (channel = GOV_PORTAL_API, syntax FA_VAT XML parsed correctly).
    const invA = listA1.invoices.find((i: any) => i.externalId === 'KSEF-A-1');
    expect(invA).toBeDefined();
    expect(invA.invoiceNumber).toBe('FV/A/1');
    expect(invA.sellerTaxId).toBe('9999999999');
    expect(invA.sellerName).toBe('Seller Sp. z o.o.');
    expect(invA.totalGross).toBeCloseTo(1230);
    expect(invA.channel).toBe('GOV_PORTAL_API');
    expect(invA.status).toBe('PARSED');

    // Multi-tenant scoping: company-B's list must NOT contain company-A's invoices, and vice versa.
    expect(listA1.invoices.some((i: any) => i.externalId.startsWith('KSEF-B'))).toBe(false);
    expect(listB1.invoices.some((i: any) => i.externalId.startsWith('KSEF-A'))).toBe(false);

    const createCallsAfterFirstPoll = mockPrisma.inboundInvoice.create.mock.calls.length;
    expect(createCallsAfterFirstPoll).toBe(3);

    // ---- Second poll (re-poll, same overlapping window) — must dedup, not duplicate ----
    const report2 = await poller.tick();
    expect(report2.fetched).toBe(3);
    expect(report2.routed).toBe(0);
    expect(report2.duplicates).toBe(3);

    // No new rows were created — dedup via InboundInvoiceService's (channel, externalId) key.
    expect(mockPrisma.inboundInvoice.create).toHaveBeenCalledTimes(createCallsAfterFirstPoll);

    const listA2 = await inboundInvoices.list('company-A');
    const listB2 = await inboundInvoices.list('company-B');
    expect(listA2.total).toBe(2); // unchanged
    expect(listB2.total).toBe(1); // unchanged

    // getOne() also respects scoping — company-B may not fetch company-A's invoice by id.
    const idA1 = listA2.invoices[0].id;
    await expect(inboundInvoices.getOne(idA1, 'company-B')).rejects.toThrow();
    await expect(inboundInvoices.getOne(idA1, 'company-A')).resolves.toBeDefined();
  });

  it('a company with zero KSeF-configured credentials never polls (offline-safe)', async () => {
    const credentials = mockCredentials([]);
    const ksefPort = new KsefInboxPort({ credentials });

    const mockPrisma = makeMockPrisma();
    const inboundInvoices = new InboundInvoiceService(mockPrisma);
    const documentSink = new InboundInvoiceDocumentSink(inboundInvoices);
    const router = new InboundRouter({ applySignal: () => {}, store: new InMemoryCallbackStore() });
    const poller = new InboxPoller({ ports: [ksefPort], router, documentSink });

    const report = await poller.tick();
    expect(report).toEqual({ fetched: 0, routed: 0, unmatched: 0, duplicates: 0, errors: 0 });
    expect(mockPrisma.inboundInvoice.create).not.toHaveBeenCalled();
  });
});
