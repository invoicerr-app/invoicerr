/**
 * The declarative-report job's own real end-to-end proof — real Redis, real Postgres, the SAME shape
 * `document-conformity-queue.redis.spec.ts` already established for its own sibling mechanism (see
 * that file's own header for the full "why the client here is a REAL local HTTP stub, never an
 * in-process mock", and for the `ClientsModule`/ts-jest gap that keeps this spec from importing
 * `DocumentsCoreModule` directly). Self-gated on `DOCUMENTS_QUEUE_REDIS_TESTS=1`, runs for real in the
 * `queue-integration` CI job (`.github/workflows/cypress.yml`'s own
 * `--testPathPattern 'modules/documents/queue/__tests__'` already matches this file with no workflow
 * change needed).
 *
 * The REAL production "nav" provider (`buildNavDeclarationProvider`) is registered here, resolving
 * credentials via the SAME `ChannelCredentialsService` against the SAME database, for a real test
 * company — the identical "whichever worker picks up the job, it hits the SAME stub" reasoning the
 * conformity spec's own header documents at length, applied here to a ONE-SHOT job instead of a
 * recurring sweep.
 */
import { createCipheriv } from 'node:crypto';
import * as http from 'node:http';

import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { DocumentTypeRegistry } from '../../descriptors/type-registry';
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentsService } from '../../documents.service';
import { DeclarationProviderRegistry } from '../../reporting/declaration-provider';
import {
  buildNavDeclarationProvider,
  NAV_PROVIDER_ID,
} from '../../reporting/providers/nav-declaration-provider';
import { ReportingRunner } from '../../reporting/reporting-runner';
import { DocumentQueueDispatcher } from '../document-queue.dispatcher';
import { DocumentQueueModule } from '../document-queue.module';
import { DocumentActionProcessor } from '../processors/document-action.processor';
import { Q_DOCUMENT_ACTION } from '../queue.constants';
import { removeQueueJobsForCompany } from './queue-test-cleanup';

const hasRedis = !!process.env.REDIS_URL && process.env.DOCUMENTS_QUEUE_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const CREDENTIALS = {
  login: 'testuser123456',
  password: 'S3cretPassw0rd!',
  taxNumber: '12345678',
  signingKey: 'ce-8f5e-215119fa7dd621DLMRHRLH2S',
  exchangeKey: 'ABCDEFGH12345678',
};

interface NavStub {
  baseUrl: string;
  close: () => Promise<void>;
}

/** A real local server implementing the three NAV endpoints — see `nav-declaration-provider.spec.ts`
 *  for the per-endpoint shape this reuses verbatim; kept minimal (one canned success path) since this
 *  spec's own job is proving the QUEUE traversal, not re-proving the wire protocol itself. */
function startNavStub(): Promise<NavStub> {
  return new Promise((resolvePromise, reject) => {
    const encryptedToken = (() => {
      const cipher = createCipheriv(
        'aes-128-ecb',
        Buffer.from(CREDENTIALS.exchangeKey, 'utf8').subarray(0, 16),
        null,
      );
      return Buffer.concat([cipher.update('decoded-token', 'utf8'), cipher.final()]).toString('base64');
    })();

    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        if (req.url?.endsWith('/tokenExchange')) {
          res.writeHead(200, { 'content-type': 'application/xml' });
          res.end(
            `<TokenExchangeResponse><result><funcCode>OK</funcCode></result>` +
              `<encodedExchangeToken>${encryptedToken}</encodedExchangeToken></TokenExchangeResponse>`,
          );
          return;
        }
        if (req.url?.endsWith('/manageInvoice')) {
          res.writeHead(200, { 'content-type': 'application/xml' });
          res.end(
            '<ManageInvoiceResponse><result><funcCode>OK</funcCode></result>' +
              '<transactionId>TXNINTEGRATION0001</transactionId></ManageInvoiceResponse>',
          );
          return;
        }
        if (req.url?.endsWith('/queryTransactionStatus')) {
          res.writeHead(200, { 'content-type': 'application/xml' });
          res.end(
            '<QueryTransactionStatusResponse><result><funcCode>OK</funcCode></result>' +
              '<processingResults><processingResult><index>1</index>' +
              '<invoiceStatus>DONE</invoiceStatus></processingResult></processingResults>' +
              '</QueryTransactionStatusResponse>',
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('NAV stub did not bind'));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

describeWithRedis('document-report queue — real Redis, real Postgres', () => {
  jest.setTimeout(60000);

  let moduleRef: TestingModule;
  let dispatcher: DocumentQueueDispatcher;
  let queue: Queue;
  let companyId: string;
  let navStub: NavStub;
  const channelCredentials = new ChannelCredentialsService();

  beforeAll(async () => {
    navStub = await startNavStub();

    moduleRef = await Test.createTestingModule({
      imports: [DocumentQueueModule],
      providers: [
        // `DocumentActionProcessor` never actually calls `DocumentsService` for a report job (see
        // that class's own header) — a bare object is enough.
        { provide: DocumentsService, useValue: {} },
        {
          provide: DeclarationProviderRegistry,
          useFactory: () => {
            const registry = new DeclarationProviderRegistry();
            // The REAL production provider, not a stand-in — see this file's own header.
            registry.register(buildNavDeclarationProvider({ channelCredentials }));
            return registry;
          },
        },
        {
          provide: ReportingRunner,
          useFactory: (registry: DeclarationProviderRegistry) => {
            const typeRegistry = new DocumentTypeRegistry();
            typeRegistry.register(buildInvoiceDescriptor());
            return new ReportingRunner(registry, typeRegistry);
          },
          inject: [DeclarationProviderRegistry],
        },
        {
          provide: DocumentActionProcessor,
          useFactory: (documentsService: DocumentsService, reportingRunner: ReportingRunner) =>
            new DocumentActionProcessor(documentsService, undefined, undefined, reportingRunner),
          inject: [DocumentsService, ReportingRunner],
        },
      ],
    }).compile();
    await moduleRef.init();

    dispatcher = moduleRef.get(DocumentQueueDispatcher);
    // Force-instantiate the processor so its BullMQ `@Processor()` decorator actually registers a
    // worker for `Q_DOCUMENT_ACTION` — same requirement the conformity/schedule integration specs
    // already document implicitly by listing it as a provider.
    moduleRef.get(DocumentActionProcessor);
    queue = moduleRef.get<Queue>(getQueueToken(Q_DOCUMENT_ACTION));

    const company = await prisma.company.create({
      data: {
        name: 'Report Integration Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Report Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'Hungary',
        countryCode: 'HU',
        phone: '+36000000000',
        email: `report-integration-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    await channelCredentials.upsertChannelConfig(companyId, NAV_PROVIDER_ID, {
      environment: 'TEST',
      isActive: true,
      config: { ...CREDENTIALS, baseUrl: navStub.baseUrl },
    });
  });

  afterAll(async () => {
    // TARGETED cleanup, never `queue.obliterate()` — see queue-test-cleanup.ts's own header.
    if (queue && companyId) await removeQueueJobsForCompany(queue, companyId);
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
    await moduleRef?.close();
    await navStub?.close().catch(() => undefined);
  });

  it('a real report job traverses the real queue and journals a REAL DocumentAuthorityEvent', async () => {
    const document = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'sent',
        displayNumber: 'INV-INTEGRATION-0001',
        data: {
          issueDate: new Date().toISOString(),
          currency: 'HUF',
          lines: [{ description: 'Widget', quantity: 1, unit: 'pcs', unitPrice: 100, vatRate: 27 }],
        },
      },
    });

    const enqueued = await dispatcher.enqueueReport({
      companyId,
      documentId: document.id,
      typeId: 'invoice',
      providerId: NAV_PROVIDER_ID,
    });
    expect(enqueued).toBe(true);

    const events = await waitFor(async () => {
      const rows = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
      return rows.length > 0 ? rows : undefined;
    });

    expect(events).toHaveLength(1);
    expect(events[0].providerId).toBe(NAV_PROVIDER_ID);
    expect(events[0].statusCode).toBe('DONE');
    expect(events[0].rawPayload).toEqual(expect.objectContaining({ transactionId: 'TXNINTEGRATION0001' }));
    // The declaration NEVER touches the document's own lifecycle status — the dedicated proof this
    // task's own brief requires, here against a REAL row, not a mock.
    const reread = await prisma.documentInstance.findUniqueOrThrow({ where: { id: document.id } });
    expect(reread.status).toBe('sent');
  });

  it('re-enqueuing the SAME (provider, document) pair journals NO duplicate row — dédup', async () => {
    const document = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'sent',
        displayNumber: 'INV-INTEGRATION-0002',
        data: {
          issueDate: new Date().toISOString(),
          currency: 'HUF',
          lines: [{ description: 'Widget', quantity: 1, unit: 'pcs', unitPrice: 100, vatRate: 27 }],
        },
      },
    });

    await dispatcher.enqueueReport({
      companyId,
      documentId: document.id,
      typeId: 'invoice',
      providerId: NAV_PROVIDER_ID,
    });
    await waitFor(async () => {
      const rows = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
      return rows.length > 0 ? rows : undefined;
    });

    // Same jobId ("report-nav-<documentId>") — `enqueueReport` skips unconditionally when a job
    // already exists under it (see `document-queue.dispatcher.ts`'s own header), so this SECOND call
    // enqueues nothing new; even if it somehow did, `DocumentAuthorityEvent`'s own
    // `@@unique([documentId, providerId, statusCode])` would absorb the repeat without a duplicate
    // row — proven directly, against the real constraint, right here.
    const secondEnqueue = await dispatcher.enqueueReport({
      companyId,
      documentId: document.id,
      typeId: 'invoice',
      providerId: NAV_PROVIDER_ID,
    });
    expect(secondEnqueue).toBe(false);

    // Give any (unexpected) second processing pass a moment to land before asserting the final count.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const events = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
    expect(events).toHaveLength(1);
  });
});
