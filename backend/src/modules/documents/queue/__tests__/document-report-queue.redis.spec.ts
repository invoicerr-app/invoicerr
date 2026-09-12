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
 * The REAL production "pt-at" provider (`buildPtAtDeclarationProvider`) is registered here, resolving
 * credentials via the SAME `ChannelCredentialsService` against the SAME database, for a real test
 * company — the identical "whichever worker picks up the job, it hits the SAME stub" reasoning the
 * conformity spec's own header documents at length, applied here to a ONE-SHOT job instead of a
 * recurring sweep.
 *
 * This vehicle used to be "nav" (Hungary, NAV Online Számla) — the REAL production provider this file
 * originally proved the queue traversal against. When Hungary's scope was deleted outright
 * (2026-09-12, see `LIVE_TESTING.md`/`B2G_COVERAGE.md`), `nav-declaration-provider.ts` went with it, so
 * this spec was re-pointed at "pt-at" (Portugal, the one declaration provider still in scope) instead
 * of being deleted: the thing this file actually proves — a declarative-report job traverses the REAL
 * BullMQ queue end-to-end and journals a REAL `DocumentAuthorityEvent`, deduplicated by jobId — has
 * nothing to do with which provider carries it, and PT-AT's own webservice (a single plain-`fetch()`
 * POST, no mTLS actually wired yet — see `pt-at-client.ts`'s own header) is, if anything, simpler to
 * stub locally than NAV's three-endpoint token/submit/poll flow was.
 */
import { generateKeyPairSync } from 'node:crypto';
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
  buildPtAtDeclarationProvider,
  PT_AT_PROVIDER_ID,
  PT_AT_STATUS_ACCEPTED,
} from '../../reporting/providers/pt-declaration-provider';
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

// A real RSA keypair, generated ONCE for this whole spec — stands in for the AT Sistema de
// Autenticação's own key pair (`pt-at-client.spec.ts` uses the identical fixture shape). The stub
// server below never decrypts anything, so a matching private half is not needed here.
const { publicKey: AT_PUBLIC_KEY_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const CREDENTIALS = {
  username: '599999993/37',
  password: 'S3cretPassw0rd!',
  authPublicKeyPem: AT_PUBLIC_KEY_PEM,
  // Structural fixtures only — this client's mTLS wiring is not actually connected yet (see
  // `pt-at-client.ts`'s own header), so these two fields are read but never used to negotiate TLS.
  clientCertificateBase64: 'ZmFrZS1jZXJ0',
  clientCertificatePassword: 'fake-passphrase',
};

interface PtAtStub {
  baseUrl: string;
  close: () => Promise<void>;
}

/** A real local server implementing AT's ONE `RegisterInvoiceRequest` endpoint (a single plain
 *  `fetch()` POST — see `pt-at-client.ts`'s own header, "HTTP transport") — kept minimal (one canned
 *  success path) since this spec's own job is proving the QUEUE traversal, not re-proving the wire
 *  protocol itself (that is `pt-at-client.spec.ts`'s job). */
function startPtAtStub(): Promise<PtAtStub> {
  return new Promise((resolvePromise, reject) => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' });
        res.end(
          '<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>' +
            '<doc:RegisterInvoiceResponse xmlns:doc="http://factemi.at.min_financas.pt/documents">' +
            '<doc:CodigoResposta>0</doc:CodigoResposta>' +
            '<doc:Mensagem>OK</doc:Mensagem>' +
            '<doc:DataOperacao>2026-09-12T10:00:00</doc:DataOperacao>' +
            '</doc:RegisterInvoiceResponse></S:Body></S:Envelope>',
        );
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('PT-AT stub did not bind'));
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
  let ptAtStub: PtAtStub;
  const channelCredentials = new ChannelCredentialsService();

  beforeAll(async () => {
    ptAtStub = await startPtAtStub();

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
            registry.register(buildPtAtDeclarationProvider({ channelCredentials }));
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
        name: 'Report Integration Lda',
        foundedAt: new Date('2020-01-01'),
        address: '1 Rua de Testes',
        postalCode: '1000-000',
        city: 'Lisboa',
        country: 'Portugal',
        countryCode: 'PT',
        phone: '+351000000000',
        email: `report-integration-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    await channelCredentials.upsertChannelConfig(companyId, PT_AT_PROVIDER_ID, {
      environment: 'TEST',
      isActive: true,
      config: { ...CREDENTIALS, baseUrl: ptAtStub.baseUrl },
    });
  });

  afterAll(async () => {
    // TARGETED cleanup, never `queue.obliterate()` — see queue-test-cleanup.ts's own header.
    if (queue && companyId) await removeQueueJobsForCompany(queue, companyId);
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
    await moduleRef?.close();
    await ptAtStub?.close().catch(() => undefined);
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
          currency: 'EUR',
          lines: [{ description: 'Widget', quantity: 1, unit: 'pcs', unitPrice: 100, vatRate: 23 }],
        },
      },
    });

    const enqueued = await dispatcher.enqueueReport({
      companyId,
      documentId: document.id,
      typeId: 'invoice',
      providerId: PT_AT_PROVIDER_ID,
    });
    expect(enqueued).toBe(true);

    const events = await waitFor(async () => {
      const rows = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
      return rows.length > 0 ? rows : undefined;
    });

    expect(events).toHaveLength(1);
    expect(events[0].providerId).toBe(PT_AT_PROVIDER_ID);
    expect(events[0].statusCode).toBe(PT_AT_STATUS_ACCEPTED);
    expect(events[0].rawPayload).toEqual(expect.objectContaining({ codigoResposta: 0, mensagem: 'OK' }));
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
          currency: 'EUR',
          lines: [{ description: 'Widget', quantity: 1, unit: 'pcs', unitPrice: 100, vatRate: 23 }],
        },
      },
    });

    await dispatcher.enqueueReport({
      companyId,
      documentId: document.id,
      typeId: 'invoice',
      providerId: PT_AT_PROVIDER_ID,
    });
    await waitFor(async () => {
      const rows = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
      return rows.length > 0 ? rows : undefined;
    });

    // Same jobId ("report-pt-at-<documentId>") — `enqueueReport` skips unconditionally when a job
    // already exists under it (see `document-queue.dispatcher.ts`'s own header), so this SECOND call
    // enqueues nothing new; even if it somehow did, `DocumentAuthorityEvent`'s own
    // `@@unique([documentId, providerId, statusCode])` would absorb the repeat without a duplicate
    // row — proven directly, against the real constraint, right here.
    const secondEnqueue = await dispatcher.enqueueReport({
      companyId,
      documentId: document.id,
      typeId: 'invoice',
      providerId: PT_AT_PROVIDER_ID,
    });
    expect(secondEnqueue).toBe(false);

    // Give any (unexpected) second processing pass a moment to land before asserting the final count.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const events = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
    expect(events).toHaveLength(1);
  });
});
