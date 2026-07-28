/**
 * InboxPoller — unit tests.
 *
 * Tests:
 *   - tick() with a new message → routed once via InboundRouter
 *   - tick() with a duplicate message → dropped (no double-routing)
 *   - tick() when unconfigured (NullInboxPort) → no-op
 *   - port.poll() error → error counted, other ports still polled
 */
import { InboxPoller } from './inbox-poller';
import { NullInboxPort, InboxMessage, InboxPort } from './inbox-port';
import type { InboundRouter } from './inbound-router';
import type { ReceiveResult } from './inbound-router';
import type { InboundDocumentSink, InboundDocumentSinkResult } from './inbound-document-sink';

function mockRouter(result: ReceiveResult): jest.Mocked<Pick<InboundRouter, 'receive'>> {
  return { receive: jest.fn().mockResolvedValue(result) };
}

function mockDocumentSink(result: InboundDocumentSinkResult): jest.Mocked<InboundDocumentSink> {
  return { receive: jest.fn().mockResolvedValue(result) };
}

const BASE_MSG: InboxMessage = {
  messageId: 'sftp-0001',
  channel: 'SDI',
  correlationKey: '12345678',
  status: 'notifica RC - consegnata (delivery receipt)',
  rawRef: 'sdi:12345678:RC:2026-07-01T10:00:00Z',
};

describe('InboxPoller.tick()', () => {
  it('routes a new message and returns routed=1', async () => {
    const router = mockRouter({
      kind: 'ROUTED',
      documentId: 'doc-1',
      signal: { type: 'INBOUND_STATUS', status: 'notifica RC - consegnata (delivery receipt)' },
    });
    const port: InboxPort = {
      id: 'sftp:sdi',
      poll: jest.fn().mockResolvedValue([BASE_MSG]),
    };

    const poller = new InboxPoller({ ports: [port], router: router as unknown as InboundRouter });
    const report = await poller.tick();

    expect(report.fetched).toBe(1);
    expect(report.routed).toBe(1);
    expect(report.duplicates).toBe(0);
    expect(report.errors).toBe(0);
    expect(router.receive).toHaveBeenCalledWith({
      channel: 'SDI',
      correlationKey: '12345678',
      status: BASE_MSG.status,
      rawRef: BASE_MSG.rawRef,
    });
  });

  it('drops a duplicate message (router returns DUPLICATE)', async () => {
    const router = mockRouter({ kind: 'DUPLICATE' });
    const port: InboxPort = {
      id: 'sftp:sdi',
      poll: jest.fn().mockResolvedValue([BASE_MSG]),
    };

    const poller = new InboxPoller({ ports: [port], router: router as unknown as InboundRouter });
    const report = await poller.tick();

    expect(report.fetched).toBe(1);
    expect(report.routed).toBe(0);
    expect(report.duplicates).toBe(1);
    expect(router.receive).toHaveBeenCalledTimes(1);
  });

  it('increments unmatched when router returns UNMATCHED', async () => {
    const router = mockRouter({ kind: 'UNMATCHED', correlationKey: '99999' });
    const port: InboxPort = {
      id: 'sftp:sdi',
      poll: jest.fn().mockResolvedValue([BASE_MSG]),
    };

    const poller = new InboxPoller({ ports: [port], router: router as unknown as InboundRouter });
    const report = await poller.tick();

    expect(report.unmatched).toBe(1);
  });

  it('is a no-op when NullInboxPort is used', async () => {
    const router = mockRouter({
      kind: 'ROUTED',
      documentId: 'doc-x',
      signal: { type: 'INBOUND_STATUS', status: '' },
    });
    const poller = new InboxPoller({
      ports: [new NullInboxPort()],
      router: router as unknown as InboundRouter,
    });
    const report = await poller.tick();

    expect(report.fetched).toBe(0);
    expect(report.routed).toBe(0);
    expect(router.receive).not.toHaveBeenCalled();
  });

  it('is a no-op when no ports are configured', async () => {
    const router = mockRouter({
      kind: 'ROUTED',
      documentId: 'doc-x',
      signal: { type: 'INBOUND_STATUS', status: '' },
    });
    const poller = new InboxPoller({ ports: [], router: router as unknown as InboundRouter });
    const report = await poller.tick();

    expect(report.fetched).toBe(0);
    expect(router.receive).not.toHaveBeenCalled();
  });

  it('records an error and continues when port.poll() throws', async () => {
    const failingPort: InboxPort = {
      id: 'sftp:broken',
      poll: jest.fn().mockRejectedValue(new Error('SFTP connection refused')),
    };
    const okPort: InboxPort = {
      id: 'sftp:ok',
      poll: jest.fn().mockResolvedValue([BASE_MSG]),
    };
    const router = mockRouter({
      kind: 'ROUTED',
      documentId: 'doc-1',
      signal: { type: 'INBOUND_STATUS', status: '' },
    });

    const poller = new InboxPoller({
      ports: [failingPort, okPort],
      router: router as unknown as InboundRouter,
    });
    const report = await poller.tick();

    expect(report.errors).toBe(1); // failing port counted
    expect(report.routed).toBe(1); // ok port still processed
    expect(report.fetched).toBe(1);
  });

  it('uses messageId as rawRef when rawRef is not provided', async () => {
    const router = mockRouter({
      kind: 'ROUTED',
      documentId: 'doc-2',
      signal: { type: 'INBOUND_STATUS', status: '' },
    });
    const msg: InboxMessage = { ...BASE_MSG, rawRef: undefined };
    const port: InboxPort = {
      id: 'sftp:sdi',
      poll: jest.fn().mockResolvedValue([msg]),
    };

    const poller = new InboxPoller({ ports: [port], router: router as unknown as InboundRouter });
    await poller.tick();

    expect(router.receive).toHaveBeenCalledWith(expect.objectContaining({ rawRef: 'sftp-0001' }));
  });
});

// ---------------------------------------------------------------------------
// documentSink routing — full-document messages (M-6 / F-15: KSeF purchase-invoice reception)
// bypass the status-correlation router entirely.
// ---------------------------------------------------------------------------

const DOC_MSG: InboxMessage = {
  messageId: 'ksef:KSEF-001',
  channel: 'GOV_PORTAL_API',
  correlationKey: 'KSEF-001',
  status: 'ksef-purchase-invoice-received',
  rawRef: 'KSEF-001',
  documentBytes: Buffer.from('<Faktura>test</Faktura>', 'utf-8'),
  companyId: 'company-A',
  providerId: 'ksef',
  syntax: 'FA_VAT',
  senderId: '9999999999',
};

describe('InboxPoller.tick() — documentSink routing', () => {
  it('routes a documentBytes message to the documentSink, not the router', async () => {
    const router = mockRouter({ kind: 'UNMATCHED', correlationKey: 'should-not-be-called' });
    const sink = mockDocumentSink({ kind: 'STORED', id: 'ibi_1' });
    const port: InboxPort = { id: 'ksef:query', poll: jest.fn().mockResolvedValue([DOC_MSG]) };

    const poller = new InboxPoller({
      ports: [port],
      router: router as unknown as InboundRouter,
      documentSink: sink,
    });
    const report = await poller.tick();

    expect(router.receive).not.toHaveBeenCalled();
    expect(sink.receive).toHaveBeenCalledWith({
      companyId: 'company-A',
      channel: 'GOV_PORTAL_API',
      providerId: 'ksef',
      externalId: 'KSEF-001',
      rawPayload: '<Faktura>test</Faktura>',
      syntax: 'FA_VAT',
      senderId: '9999999999',
    });
    expect(report.fetched).toBe(1);
    expect(report.routed).toBe(1);
    expect(report.duplicates).toBe(0);
    expect(report.errors).toBe(0);
  });

  it('counts a DUPLICATE sink result as a duplicate, not routed', async () => {
    const router = mockRouter({ kind: 'UNMATCHED', correlationKey: 'x' });
    const sink = mockDocumentSink({ kind: 'DUPLICATE', id: 'ibi_1' });
    const port: InboxPort = { id: 'ksef:query', poll: jest.fn().mockResolvedValue([DOC_MSG]) };

    const poller = new InboxPoller({
      ports: [port],
      router: router as unknown as InboundRouter,
      documentSink: sink,
    });
    const report = await poller.tick();

    expect(report.routed).toBe(0);
    expect(report.duplicates).toBe(1);
  });

  it('drops the message and counts an error when no documentSink is configured', async () => {
    const router = mockRouter({ kind: 'UNMATCHED', correlationKey: 'x' });
    const port: InboxPort = { id: 'ksef:query', poll: jest.fn().mockResolvedValue([DOC_MSG]) };

    const poller = new InboxPoller({ ports: [port], router: router as unknown as InboundRouter });
    const report = await poller.tick();

    expect(router.receive).not.toHaveBeenCalled();
    expect(report.errors).toBe(1);
    expect(report.routed).toBe(0);
  });

  it('drops the message and counts an error when documentBytes is present but companyId is missing', async () => {
    const router = mockRouter({ kind: 'UNMATCHED', correlationKey: 'x' });
    const sink = mockDocumentSink({ kind: 'STORED', id: 'ibi_1' });
    const msg: InboxMessage = { ...DOC_MSG, companyId: undefined };
    const port: InboxPort = { id: 'ksef:query', poll: jest.fn().mockResolvedValue([msg]) };

    const poller = new InboxPoller({
      ports: [port],
      router: router as unknown as InboundRouter,
      documentSink: sink,
    });
    const report = await poller.tick();

    expect(sink.receive).not.toHaveBeenCalled();
    expect(report.errors).toBe(1);
  });

  it('status-ping messages (no documentBytes) still route through the router even when a documentSink is configured', async () => {
    const router = mockRouter({
      kind: 'ROUTED',
      documentId: 'doc-1',
      signal: { type: 'INBOUND_STATUS', status: BASE_MSG.status },
    });
    const sink = mockDocumentSink({ kind: 'STORED', id: 'ibi_1' });
    const port: InboxPort = { id: 'sftp:sdi', poll: jest.fn().mockResolvedValue([BASE_MSG]) };

    const poller = new InboxPoller({
      ports: [port],
      router: router as unknown as InboundRouter,
      documentSink: sink,
    });
    const report = await poller.tick();

    expect(sink.receive).not.toHaveBeenCalled();
    expect(router.receive).toHaveBeenCalledTimes(1);
    expect(report.routed).toBe(1);
  });
});
