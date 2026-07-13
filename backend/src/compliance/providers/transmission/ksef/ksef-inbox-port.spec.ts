/**
 * KsefInboxPort — unit tests (M-6 / F-15: PL KSeF purchase-invoice reception).
 *
 * The mocked KSeF HTTP responses mirror the REAL KSeF 2.0 API shape (auth challenge/ksef-token/
 * status/redeem — same as ksef-transmission.spec.ts/ksef-client.spec.ts; invoices/query/metadata +
 * invoices/ksef/{ksefNumber} — same shape as the real OpenAPI spec, see ksef-client.spec.ts).
 *
 * No network, no real credentials — `httpClientFactory` is injected exactly like
 * ksef-client.spec.ts's `mockHttp()`. Real KSeF test-environment vendorized keys ARE used
 * (loadVendorizedKeys('test') reads the real PEM files already checked into
 * certs/ksef/test/*.pem — same as every other KSeF spec).
 */
import { KsefInboxPort } from './ksef-inbox-port';
import { ActiveChannelConfig, ChannelCredentialsPort } from '../channel-credentials-port';
import { HttpRequest, HttpResponse, KsefHttpClient } from './ksef-client';
import { RecordingComplianceLogger } from '../../../execution/logger';

// ---------------------------------------------------------------------------
// Mock KSeF HTTP transport — routes by path/NIP, mirrors real KSeF request/response shapes.
// ---------------------------------------------------------------------------

interface FixtureInvoice {
  ksefNumber: string;
  xml: string;
  sellerNip?: string;
}

/**
 * Builds an `httpClientFactory` shared across every `pollCompany()` call within a test. Company
 * polls are sequential (KsefInboxPort.poll() awaits each in turn), so a single closure-scoped
 * "current NIP" (captured from the authKsefToken request body) is enough to route subsequent
 * query/download calls within that company's poll to the right fixture set — no concurrency.
 */
function buildKsefHttpMock(dataByNip: Record<string, FixtureInvoice[]>, opts?: { failAuthForNip?: string }) {
  let currentNip = '';
  const calls: HttpRequest[] = [];

  const factory = (): KsefHttpClient => ({
    request: jest.fn(async (req: HttpRequest): Promise<HttpResponse> => {
      calls.push(req);

      if (req.path.includes('/auth/challenge')) {
        return {
          status: 200,
          body: {
            challenge: 'CHAL-1',
            timestamp: '2026-07-13T00:00:00.000Z',
            timestampMs: 1,
            clientIp: '1.2.3.4',
          },
        };
      }
      if (req.path.includes('/auth/ksef-token')) {
        currentNip = (req.body as { contextIdentifier: { value: string } }).contextIdentifier.value;
        if (opts?.failAuthForNip === currentNip) {
          return {
            status: 200,
            body: { referenceNumber: 'REF-1', authenticationToken: { token: 'a', validUntil: '' } },
          };
        }
        return {
          status: 202,
          body: { referenceNumber: 'REF-1', authenticationToken: { token: 'auth-tok', validUntil: '' } },
        };
      }
      if (req.path.includes('/auth/REF-1')) {
        if (opts?.failAuthForNip === currentNip) {
          return { status: 200, body: { status: { code: 400, description: 'Bad NIP' } } };
        }
        return { status: 200, body: { status: { code: 200, description: 'OK' } } };
      }
      if (req.path.includes('/auth/token/redeem')) {
        return {
          status: 200,
          body: {
            accessToken: { token: `access-${currentNip}`, validUntil: '' },
            refreshToken: { token: `refresh-${currentNip}`, validUntil: '' },
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
              invoiceNumber: `FV/${f.ksefNumber}`,
              issueDate: '2026-07-01',
              invoicingDate: '2026-07-01T10:00:00Z',
              acquisitionDate: '2026-07-01T10:01:00Z',
              permanentStorageDate: '2026-07-01T10:02:00Z',
              seller: { nip: f.sellerNip ?? '9999999999', name: 'Seller Sp. z o.o.' },
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
        if (!found) return { status: 404, body: { code: 21164, message: 'not found' } };
        return { status: 200, body: found.xml };
      }
      return { status: 404, body: {} };
    }),
  });

  return { factory, calls };
}

function fa2Xml(ksefNumber: string, invoiceNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Naglowek><KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza></Naglowek>
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
  <!-- ${ksefNumber} -->
</Faktura>`;
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
    config: { nip, authToken: `token-for-${companyId}` },
    isActive: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KsefInboxPort', () => {
  it('id is "ksef:query"', () => {
    const port = new KsefInboxPort({ credentials: mockCredentials([]) });
    expect(port.id).toBe('ksef:query');
  });

  it('poll() returns [] when the credentials port does not support listActiveByProvider (offline-safe)', async () => {
    const credentials: ChannelCredentialsPort = {
      resolve: jest.fn(),
      resolveActive: jest.fn(),
      // listActiveByProvider intentionally omitted
    };
    const port = new KsefInboxPort({ credentials });
    expect(await port.poll()).toEqual([]);
  });

  it('poll() returns [] when zero companies have an active ksef config (self-inert)', async () => {
    const port = new KsefInboxPort({ credentials: mockCredentials([]) });
    expect(await port.poll()).toEqual([]);
  });

  it('poll() returns [] and does not throw when listActiveByProvider itself throws', async () => {
    const credentials: ChannelCredentialsPort = {
      resolve: jest.fn(),
      resolveActive: jest.fn(),
      listActiveByProvider: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const port = new KsefInboxPort({ credentials, log: new RecordingComplianceLogger() });
    await expect(port.poll()).resolves.toEqual([]);
  });

  it('queries subjectType=Subject2 (buyer) and yields one InboxMessage per invoice, carrying documentBytes', async () => {
    const nip = '1111111111';
    const invoices: FixtureInvoice[] = [
      { ksefNumber: 'KSEF-001', xml: fa2Xml('KSEF-001', 'FV/2026/001') },
      { ksefNumber: 'KSEF-002', xml: fa2Xml('KSEF-002', 'FV/2026/002') },
    ];
    const { factory, calls } = buildKsefHttpMock({ [nip]: invoices });
    const credentials = mockCredentials([ksefConfig('company-A', nip)]);
    const port = new KsefInboxPort({ credentials, httpClientFactory: factory });

    const messages = await port.poll();

    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.rawRef).sort()).toEqual(['KSEF-001', 'KSEF-002']);
    for (const m of messages) {
      expect(m.companyId).toBe('company-A');
      expect(m.channel).toBe('GOV_PORTAL_API');
      expect(m.providerId).toBe('ksef');
      expect(m.syntax).toBe('FA_VAT');
      expect(m.documentBytes).toBeInstanceOf(Buffer);
      expect(m.documentBytes!.toString('utf-8')).toContain('<Faktura');
      expect(m.senderId).toBe('9999999999');
    }

    // The query request used subjectType=Subject2 and a PermanentStorage dateRange.
    const queryCall = calls.find((c) => c.path.includes('/invoices/query/metadata'));
    expect(queryCall).toBeDefined();
    const body = queryCall!.body as { subjectType: string; dateRange: { dateType: string } };
    expect(body.subjectType).toBe('Subject2');
    expect(body.dateRange.dateType).toBe('PermanentStorage');
  });

  it('polls multiple companies independently — each sees only its own NIP-scoped invoices', async () => {
    const nipA = '1111111111';
    const nipB = '2222222222';
    const { factory } = buildKsefHttpMock({
      [nipA]: [{ ksefNumber: 'KSEF-A-1', xml: fa2Xml('KSEF-A-1', 'FV/A/1') }],
      [nipB]: [
        { ksefNumber: 'KSEF-B-1', xml: fa2Xml('KSEF-B-1', 'FV/B/1') },
        { ksefNumber: 'KSEF-B-2', xml: fa2Xml('KSEF-B-2', 'FV/B/2') },
      ],
    });
    const credentials = mockCredentials([ksefConfig('company-A', nipA), ksefConfig('company-B', nipB)]);
    const port = new KsefInboxPort({ credentials, httpClientFactory: factory });

    const messages = await port.poll();

    expect(messages).toHaveLength(3);
    const forA = messages.filter((m) => m.companyId === 'company-A');
    const forB = messages.filter((m) => m.companyId === 'company-B');
    expect(forA.map((m) => m.rawRef)).toEqual(['KSEF-A-1']);
    expect(forB.map((m) => m.rawRef).sort()).toEqual(['KSEF-B-1', 'KSEF-B-2']);
  });

  it('a company with an auth failure yields [] for that company but does not block others', async () => {
    const nipGood = '1111111111';
    const nipBad = '3333333333';
    const { factory } = buildKsefHttpMock(
      { [nipGood]: [{ ksefNumber: 'KSEF-GOOD-1', xml: fa2Xml('KSEF-GOOD-1', 'FV/GOOD/1') }] },
      { failAuthForNip: nipBad },
    );
    const credentials = mockCredentials([
      ksefConfig('company-bad', nipBad),
      ksefConfig('company-good', nipGood),
    ]);
    const port = new KsefInboxPort({
      credentials,
      httpClientFactory: factory,
      log: new RecordingComplianceLogger(),
    });

    const messages = await port.poll();

    expect(messages).toHaveLength(1);
    expect(messages[0].companyId).toBe('company-good');
  });

  it('a company with incomplete config (missing nip/authToken) is skipped without crashing', async () => {
    const credentials = mockCredentials([
      { ...ksefConfig('company-incomplete', ''), config: { authToken: 'only-token' } },
    ]);
    const port = new KsefInboxPort({ credentials });
    await expect(port.poll()).resolves.toEqual([]);
  });

  it('a download failure for one invoice does not drop the others', async () => {
    const nip = '1111111111';
    // Metadata query returns two invoices; KSEF-MISSING has no matching download fixture (→ 404 on
    // fetch), KSEF-OK does — the custom httpClientFactory below encodes both directly.
    const credentials = mockCredentials([ksefConfig('company-A', nip)]);
    const port = new KsefInboxPort({
      credentials,
      httpClientFactory: () => ({
        request: jest.fn(async (req: HttpRequest): Promise<HttpResponse> => {
          if (req.path.includes('/auth/challenge')) {
            return {
              status: 200,
              body: { challenge: 'C', timestamp: '', timestampMs: 1, clientIp: '1.1.1.1' },
            };
          }
          if (req.path.includes('/auth/ksef-token')) {
            return {
              status: 202,
              body: { referenceNumber: 'R', authenticationToken: { token: 'a', validUntil: '' } },
            };
          }
          if (req.path.includes('/auth/R')) {
            return { status: 200, body: { status: { code: 200, description: 'OK' } } };
          }
          if (req.path.includes('/auth/token/redeem')) {
            return {
              status: 200,
              body: {
                accessToken: { token: 'acc', validUntil: '' },
                refreshToken: { token: 'r', validUntil: '' },
              },
            };
          }
          if (req.path.includes('/invoices/query/metadata')) {
            return {
              status: 200,
              body: {
                hasMore: false,
                isTruncated: false,
                invoices: [
                  {
                    ksefNumber: 'KSEF-MISSING',
                    invoiceNumber: 'x',
                    issueDate: '2026-07-01',
                    invoicingDate: '',
                    acquisitionDate: '',
                    permanentStorageDate: '',
                    seller: { nip: '9', name: 'S' },
                    buyer: { identifier: { type: 'Nip', value: nip } },
                    netAmount: 0,
                    grossAmount: 0,
                    vatAmount: 0,
                    currency: 'PLN',
                    invoicingMode: 'Online',
                    invoiceType: 'Vat',
                    formCode: { systemCode: 'FA (2)', schemaVersion: '1-0E', value: 'FA' },
                    isSelfInvoicing: false,
                    hasAttachment: false,
                    invoiceHash: 'h',
                  },
                  {
                    ksefNumber: 'KSEF-OK',
                    invoiceNumber: 'FV/OK',
                    issueDate: '2026-07-01',
                    invoicingDate: '',
                    acquisitionDate: '',
                    permanentStorageDate: '',
                    seller: { nip: '9999999999', name: 'S' },
                    buyer: { identifier: { type: 'Nip', value: nip } },
                    netAmount: 1000,
                    grossAmount: 1230,
                    vatAmount: 230,
                    currency: 'PLN',
                    invoicingMode: 'Online',
                    invoiceType: 'Vat',
                    formCode: { systemCode: 'FA (2)', schemaVersion: '1-0E', value: 'FA' },
                    isSelfInvoicing: false,
                    hasAttachment: false,
                    invoiceHash: 'h',
                  },
                ],
              },
            };
          }
          if (req.path.includes('/invoices/ksef/KSEF-MISSING')) {
            return { status: 404, body: { code: 21164, message: 'not found' } };
          }
          if (req.path.includes('/invoices/ksef/KSEF-OK')) {
            return { status: 200, body: fa2Xml('KSEF-OK', 'FV/OK') };
          }
          return { status: 404, body: {} };
        }),
      }),
      log: new RecordingComplianceLogger(),
    });

    const messages = await port.poll();
    expect(messages).toHaveLength(1);
    expect(messages[0].rawRef).toBe('KSEF-OK');
  });
});
