/**
 * TODO_PRODUIT.md T2bis — the ONE end-to-end proof `DOCUMENT_SEND_FAILED` needs, mirroring
 * `actions/async-send-webhook.spec.ts`'s own "REAL local HTTP stub, real `SlackDriver`, never a mock
 * of the HTTP client" discipline for the identical reason (see that file's own header for the full
 * "why SlackDriver, never GenericDriver/WebhooksService" reasoning — copied here rather than shared,
 * a deliberately self-contained test). `mark-send-failed.spec.ts`'s own "events" describe block
 * already proves the SSE nudge in isolation with a bare `jest.fn()`; this proves the webhook fires
 * for a genuine terminal failure and carries the error through the real driver/formatter pipeline.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { SlackDriver } from '@/modules/webhooks/drivers/slack.driver';

import { transitionsAvailableWhen } from '../descriptors/lifecycle';
import { DocumentActionTransition, DocumentTypeDescriptor } from '../descriptors/types';
import * as persistence from '../persistence';
import { DocumentWebhookEmitter } from './document-webhooks';
import { markSendFailed } from './mark-send-failed';

jest.mock('../persistence');

const SEND_TRANSITIONS: DocumentActionTransition[] = [
  { from: ['draft', 'send_failed'], to: 'sending' },
  { from: ['sending'], to: ['sent', 'send_failed'] },
];

function widgetDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'widget',
    label: 'Widget',
    fields: [],
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sending', label: 'Sending' },
      { id: 'sent', label: 'Sent' },
      { id: 'send_failed', label: 'Send failed' },
    ],
    initialStatus: 'draft',
    actions: [
      {
        id: 'send',
        label: 'Send',
        transitions: SEND_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SEND_TRANSITIONS),
      },
    ],
  };
}

function startStubServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function realEmitter(url: string): DocumentWebhookEmitter {
  const driver = new SlackDriver();
  return {
    async dispatch(event, payload) {
      await driver.send(url, { event, ...payload });
    },
  };
}

describe('markSendFailed — DOCUMENT_SEND_FAILED, against a REAL local HTTP stub (TODO_PRODUIT.md T2bis)', () => {
  afterEach(() => jest.resetAllMocks());

  it('a terminal failure makes EXACTLY ONE POST reach the stub, carrying the error and the formatted payload', async () => {
    let requestCount = 0;
    let receivedBody = '';
    const { server, url } = await startStubServer((req, res) => {
      requestCount += 1;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    try {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'sending',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        displayNumber: 'WGT-2026-0003',
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'send_failed',
        displayNumber: 'WGT-2026-0003',
      });

      await markSendFailed(() => widgetDescriptor(), {
        companyId: 'company-1',
        typeId: 'widget',
        documentId: 'doc-1',
        actionId: 'send',
        error: new Error('SMTP connection refused'),
        webhooks: realEmitter(url),
      });

      // Real network round-trip — never a mocked `fetch`, never a bypass of `SlackDriver`.
      expect(requestCount).toBe(1);

      const body = JSON.parse(receivedBody) as { attachments: Array<{ title: string; text: string }> };
      expect(body.attachments[0].title).toContain('Document Send Failed');
      expect(body.attachments[0].text).toContain('Widget #WGT-2026-0003');
      expect(body.attachments[0].text).toContain('SMTP connection refused');
    } finally {
      await closeServer(server);
    }
  });
});
