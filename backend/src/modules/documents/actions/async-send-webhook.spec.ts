/**
 * TODO_PRODUIT.md T2 / PLAN-V2 R9, updated by T2bis for the generic `DOCUMENT_SENT` vocabulary — the
 * ONE end-to-end proof the original task's own "Accepte si" demands: a REAL local HTTP stub
 * (`node:http`, never a mock of the HTTP client — same `startStubServer`/`closeServer` pattern
 * `transports/peppol-transport.spec.ts` already established for this exact reason) receives EXACTLY
 * ONE webhook on a successful send, ZERO on a failed one, ZERO at enqueue, and the payload genuinely
 * passes THROUGH the existing driver/formatter pipeline — never a shortcut straight to `fetch`.
 *
 * `async-send.spec.ts`'s own "webhooks" describe block already proves the ORCHESTRATION (when
 * `runAsyncSendAction` calls `webhooks.dispatch`, with a bare `jest.fn()`) — this file proves the
 * OTHER half: that a REAL driver (`SlackDriver`, `modules/webhooks/drivers/slack.driver.ts`,
 * UNMOCKED) actually reaches the network and genuinely calls `formatPayloadForEvent`.
 *
 * `SlackDriver` (never `WebhooksService`, and never `GenericDriver`) is imported DIRECTLY, on purpose:
 *
 *  - `GenericDriver` just forwards the raw JSON body — it would prove a POST happened, but NOTHING
 *    about "the payload passes through the existing formatters" (`ChatWebhookDriver.send`,
 *    `drivers/chat-webhook.driver.ts`, calls `formatPayloadForEvent` — `event-formatters.ts` — to
 *    build the message text; `GenericDriver` never does).
 *  - `WebhooksService` (`modules/webhooks/webhooks.service.ts`) is the production driver-SELECTION
 *    layer — but it constructs `new DiscordDriver()` unconditionally in its own driver list, and
 *    `discord.driver.ts` imports `@teever/ez-hook`, a pure-ESM JSR package ts-jest cannot compile —
 *    see `TODO_ISSUES.md`'s own documented, PRE-EXISTING "ClientsModule inimportable sous ts-jest"
 *    entry (`clients.vat-validation.spec.ts` hits the identical wall for the identical reason and
 *    works around it with a factory mock). `SlackDriver`'s own import chain (`chat-webhook.driver.ts`
 *    → `event-formatters.ts`) never touches Discord or `@teever/ez-hook` at all, so importing it
 *    DIRECTLY — skipping only `WebhooksService`'s trivial `type → driver` `.find()`, never anything
 *    this task's own webhook-EMISSION discipline is about — sidesteps that wall while keeping the
 *    formatter call, the HTTP POST, and the driver's own body shape entirely real.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { SlackDriver } from '@/modules/webhooks/drivers/slack.driver';

import * as archiveOnSend from '../archive/archive-on-send';
import * as persistence from '../persistence';
import * as reportOnSend from '../reporting/report-on-send';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { runAsyncSendAction } from './async-send';

jest.mock('../persistence');
jest.mock('../numbering/take-number');
jest.mock('../archive/archive-on-send');
jest.mock('../reporting/report-on-send');

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

/** The REAL `DocumentWebhookEmitter` production wiring (`WebhookDispatcherService.dispatch` →
 *  `WebhooksService.send` → `driver.send`) reduces, for a Slack-type webhook, to exactly this last
 *  call — see this file's own header for why the two layers ABOVE `driver.send` (the Prisma lookup,
 *  the `type → driver` selection) are deliberately not reconstructed here: neither has any logic this
 *  task's own webhook-EMISSION discipline is about, and the driver-selection one cannot even be
 *  imported under ts-jest today. */
function realEmitter(url: string): DocumentWebhookEmitter {
  const driver = new SlackDriver();
  return {
    async dispatch(event, payload) {
      await driver.send(url, { event, ...payload });
    },
  };
}

const sendingInvoice = {
  id: 'doc-1',
  typeId: 'invoice',
  status: 'sending',
  data: { client: 'client-1' },
  createdAt: new Date(),
  updatedAt: new Date(),
  number: 7,
  displayNumber: 'INV-2026-0007',
};

const sentInvoice = { ...sendingInvoice, status: 'sent' };

describe('runAsyncSendAction — DOCUMENT_SENT, against a REAL local HTTP stub (TODO_PRODUIT.md T2bis)', () => {
  afterEach(() => jest.resetAllMocks());

  it('a successful send makes EXACTLY ONE POST reach the stub, carrying the formatted (not raw) payload', async () => {
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
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingInvoice);
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(sentInvoice);
      (archiveOnSend.archiveDeliveredArtifactsIfAny as jest.Mock).mockResolvedValue(undefined);
      (reportOnSend.reportOnSendIfObligated as jest.Mock).mockResolvedValue(undefined);
      const queueDispatcher = { enqueueAction: jest.fn() };
      const deliver = jest.fn().mockResolvedValue({ message: 'Invoice sent to client-1@example.com.' });

      await runAsyncSendAction({
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        data: { client: 'client-1' },
        params: {},
        numberOnEnqueue: true,
        queueDispatcher,
        deliver,
        webhooks: realEmitter(url),
      });

      // Real network round-trip: the stub's own HTTP server actually received a request — never a
      // mocked `fetch`, never a bypass of `SlackDriver`/`ChatWebhookDriver`.
      expect(requestCount).toBe(1);

      // "le payload passe par les formatters existants" — the Slack driver's own body shape
      // (`ChatWebhook.send`, drivers/chat-webhook.driver.ts) is `{ text, attachments: [...] }`, and
      // `attachments[0].text` is EXACTLY `formatPayloadForEvent`'s own return value
      // (drivers/event-formatters.ts's `DOCUMENT_SENT` formatter: `**${documentLabel(typeId)}
      // #${documentNumber(p)}**\nSent`). Asserting the invoice's OWN displayNumber appears proves the
      // formatter genuinely read `payload.document` — T2bis's own FIXED `document` key
      // (`buildDocumentWebhookPayload`, `queue/document-webhooks.ts`) — never a raw JSON dump
      // (event-formatters.ts's own fallback on a formatter exception).
      const body = JSON.parse(receivedBody) as { attachments: Array<{ title: string; text: string }> };
      expect(body.attachments[0].title).toContain('Document Sent');
      expect(body.attachments[0].text).toContain('Invoice #INV-2026-0007');
    } finally {
      await closeServer(server);
    }
  });

  it('a delivery FAILURE makes ZERO requests reach the stub', async () => {
    let requestCount = 0;
    const { server, url } = await startStubServer((_req, res) => {
      requestCount += 1;
      res.writeHead(200).end();
    });

    try {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingInvoice);
      const queueDispatcher = { enqueueAction: jest.fn() };
      const deliver = jest.fn().mockRejectedValue(new Error('SMTP connection refused'));

      await expect(
        runAsyncSendAction({
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          data: { client: 'client-1' },
          params: {},
          numberOnEnqueue: true,
          queueDispatcher,
          deliver,
          webhooks: realEmitter(url),
        }),
      ).rejects.toThrow('SMTP connection refused');

      expect(requestCount).toBe(0);
    } finally {
      await closeServer(server);
    }
  });

  it('the ENQUEUE (phase 1) makes ZERO requests reach the stub — a submission is not a send', async () => {
    let requestCount = 0;
    const { server, url } = await startStubServer((_req, res) => {
      requestCount += 1;
      res.writeHead(200).end();
    });

    try {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({ ...sendingInvoice, status: 'draft' });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue(sendingInvoice);
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

      await runAsyncSendAction({
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        data: { client: 'client-1' },
        params: {},
        numberOnEnqueue: true,
        queueDispatcher,
        deliver: jest.fn(),
        webhooks: realEmitter(url),
      });

      expect(requestCount).toBe(0);
    } finally {
      await closeServer(server);
    }
  });
});
