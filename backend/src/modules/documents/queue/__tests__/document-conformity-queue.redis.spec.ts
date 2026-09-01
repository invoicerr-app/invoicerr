/**
 * The conformity sweep's own real end-to-end proof (root TODO item 10's own named remainder) — real
 * Redis, real Postgres, the SAME shape `document-schedule-queue.redis.spec.ts` already established
 * (see that file's own header for the `ClientsModule`/ts-jest gap that keeps both specs from
 * importing `DocumentsCoreModule` directly, and the exact reasoning behind gating on
 * `DOCUMENTS_QUEUE_REDIS_TESTS=1` rather than merely `REDIS_URL`). Self-gated, runs for real in the
 * `queue-integration` CI job (`.github/workflows/cypress.yml` — its own
 * `--testPathPattern 'modules/documents/queue/__tests__'` already matches this file with no workflow
 * change needed).
 *
 * ## Why the PDP client here is a REAL local HTTP stub, never an in-process mock
 *
 * This spec's own `Q_DOCUMENT_ACTION` queue is the SAME Redis queue a persistent `start:test` backend
 * (:4000, `WORKER_INLINE`) also consumes from whenever one happens to be running — a normal dev-machine
 * state, and how this file is actually validated. Running this spec while that backend is alive means
 * the conformity POLL job the sweep dispatches below can be picked up by EITHER worker: this process's
 * own `DocumentActionProcessor`, or the real backend's.
 *
 * An earlier version of this file registered a bespoke in-process stub poller under a FICTIONAL
 * provider id ('pdp-test-stub', registered nowhere else) specifically so the real backend's own
 * periodic sweep would never go looking for these documents on its own. That did nothing for the poll
 * job this file's own `sweepRunner.runSweep()` call dispatches onto the SHARED queue once it exists: if
 * the real backend's worker happened to win the BullMQ lock for it, its OWN registry (built for real by
 * `documents-core.module.ts`, knowing only 'pdp'/'ksef') resolved the fictional id to `undefined` —
 * `ConformitySweepRunner.runPoll` logged a warning and returned having journaled NOTHING, silently, and
 * this file's own `waitFor()` timed out waiting for events that were never coming. Green when this
 * file's own worker happened to win the race (a bare `--forceExit`-only local run, nothing else
 * listening), red the moment a real backend was also alive to steal the job — a race of test-run
 * topology, not a product defect.
 *
 * The fix makes the OPERATION identical no matter which worker performs it — the exact principle
 * `document-schedule-queue.redis.spec.ts` already leans on for this same shared-queue topology (see
 * that file's own header): there, whichever process's `DocumentsService` ends up running a job, it
 * calls the SAME real action registrations against the SAME database, so the outcome never depends on
 * who actually ran it. Here that means registering the REAL 'pdp' provider
 * (`buildPdpStatusPoller` — the exact function `documents-core.module.ts` uses in production) in THIS
 * spec's own registry too, resolving credentials via the SAME `ChannelCredentialsService` against the
 * SAME database row, for the SAME test company, that the real backend's own registry would also
 * resolve. Those credentials point at a real `node:http` server this file starts itself, on
 * `127.0.0.1`, an ephemeral port — serving the OAuth2 token exchange `PdpClient` always authenticates
 * with first, and `GET /v1.beta/invoices/:id` answering with the exact `events[]` shape
 * `pdp-status-poller.spec.ts`'s own real, session-captured superpdp fixtures use (never a top-level
 * `status_code` — see that file's own header on why that distinction is the whole point). Whichever
 * worker's `PdpClient` calls out, it hits this SAME stub and gets the SAME two events back — the race
 * disappears by construction, not by hoping the timing works out, and this file now also exercises the
 * real credential-resolution path, not merely the poll/journal mechanics.
 *
 * A side effect, deliberately embraced rather than guarded against: this spec's own documents are now
 * visible to the real backend's own periodic conformity sweep too (they carry the REAL 'pdp' provider
 * id, unlike the old fictional one) — a real 5s-cadence sweep in `.env.test`
 * (`DOCUMENT_CONFORMITY_SWEEP_INTERVAL_MS`) may poll them independently, on its own schedule. Harmless:
 * it resolves the SAME stub, and `DocumentAuthorityEvent`'s own
 * `@@unique([documentId, providerId, statusCode])` (proven directly by this file's own second test) is
 * exactly what makes an extra, independently-triggered poll journal zero additional rows, never a
 * duplicate — the identical guarantee this file already needed for its OWN two-passes-racing test.
 */
import * as http from 'node:http';

import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { AuthorityStatusPollerRegistry } from '../../conformity/authority-status-poller';
import { ConformitySweepRunner } from '../../conformity/conformity-sweep-runner';
import { buildPdpStatusPoller, PDP_PROVIDER_ID } from '../../conformity/pollers/pdp-status-poller';
import { DocumentsService } from '../../documents.service';
import { DocumentQueueDispatcher } from '../document-queue.dispatcher';
import { DocumentQueueModule } from '../document-queue.module';
import { DocumentActionProcessor } from '../processors/document-action.processor';
import { Q_DOCUMENT_ACTION } from '../queue.constants';
import { removeQueueJobsForCompany } from './queue-test-cleanup';

// Same gating discipline as `document-schedule-queue.redis.spec.ts` — see that file's own header for
// why `REDIS_URL` alone is not enough (parallel jest workers would race the same queue/database).
const hasRedis = !!process.env.REDIS_URL && process.env.DOCUMENTS_QUEUE_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

/** Polls the REAL table — proof that the background sweep/poll genuinely wrote something, not just
 *  that a function call returned. Same helper shape `document-schedule-queue.redis.spec.ts` already
 *  uses for its own `waitFor`. */
async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The two events this file's stub server always answers with — the SAME `fr:200`/`fr:202` pair
 *  (id/timestamp/text lifted VERBATIM from `pdp-status-poller.spec.ts`'s own real, session-captured
 *  `ACCEPTED_INVOICE_397536` fixture, never invented) every assertion below already expected before
 *  this fix. `isTerminal('fr:202')` is `true` on the REAL poller (`PDP_ACCEPTED_STATUS_CODE`), which is
 *  what lets the racing test below still prove "never four rows, however the race lands". */
const STUB_INVOICE_EVENTS = [
  {
    id: 1142952,
    created_at: '2026-09-01T11:00:05.118541Z',
    status_code: 'fr:200',
    status_text: 'Déposée (validée)',
  },
  {
    id: 1142954,
    created_at: '2026-09-01T11:00:05.394248Z',
    status_code: 'fr:202',
    status_text: 'Reçue par la plateforme',
  },
];

interface PdpStubServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * A REAL local HTTP server standing in for the superpdp sandbox — never an in-process mock (see this
 * file's own header for why). Serves only the two endpoints `PdpClient` actually calls for a poll: the
 * OAuth2 token exchange `authenticate()` runs before every request, and `GET /v1.beta/invoices/:id`
 * itself — regardless of the id (this stub has exactly one canned deposit, never inspects
 * `transportRef`). Any other path/method 404s.
 *
 * Stays alive until explicitly closed in `afterAll`: the real backend's own worker can retry a poll job
 * (BullMQ `attempts`) or run its own independent periodic sweep pass against the same documents after
 * this spec's own assertions have already run, so the handler never throws for an unrecognized id and
 * never assumes the test's own database rows still exist.
 */
function startPdpStub(): Promise<PdpStubServer> {
  return new Promise((resolvePromise, reject) => {
    const server = http.createServer((req, res) => {
      try {
        if (req.method === 'POST' && req.url === '/oauth2/token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ access_token: 'stub-access-token', token_type: 'bearer', expires_in: 3600 }),
          );
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/v1.beta/invoices/')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 999999,
              direction: 'out',
              external_id: 'conformity-integration-stub',
              created_at: '2026-09-01T11:00:04.184701Z',
              updated_at: '2026-09-01T11:00:05.394248Z',
              events: STUB_INVOICE_EVENTS,
            }),
          );
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      } catch {
        // Never crash this stub over a late/malformed request — see this function's own header.
        try {
          res.writeHead(500);
          res.end();
        } catch {
          /* the response may already be closed — nothing left to do */
        }
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('PDP stub server did not bind to a TCP port'));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolveClose) => {
            // Node 18.2+: force-drop any lingering keep-alive socket a real backend's `fetch` may
            // still hold open — without this, `server.close()`'s own callback (which waits for every
            // connection to end on its own) can hang well past this file's `jest.setTimeout`, failing
            // `afterAll` even though every `it()` above it already passed.
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

describeWithRedis('document-conformity sweep — real Redis, real Postgres', () => {
  jest.setTimeout(60000);

  let moduleRef: TestingModule;
  let sweepRunner: ConformitySweepRunner;
  let queue: Queue;
  let companyId: string;
  let pdpStub: PdpStubServer;
  const channelCredentials = new ChannelCredentialsService();

  beforeAll(async () => {
    pdpStub = await startPdpStub();

    moduleRef = await Test.createTestingModule({
      imports: [DocumentQueueModule],
      providers: [
        // `DocumentActionProcessor` never actually calls `DocumentsService` for a conformity job (see
        // that class's own header) — a bare object is enough.
        { provide: DocumentsService, useValue: {} },
        {
          provide: AuthorityStatusPollerRegistry,
          useFactory: () => {
            const registry = new AuthorityStatusPollerRegistry();
            // The REAL production poller, not a stand-in — see this file's own header for why this is
            // the whole fix: whichever registry (this one, or the real backend's own) resolves 'pdp',
            // it runs this exact function against the SAME database.
            registry.register(buildPdpStatusPoller({ channelCredentials }));
            return registry;
          },
        },
        {
          provide: ConformitySweepRunner,
          useFactory: (registry: AuthorityStatusPollerRegistry, dispatcher: DocumentQueueDispatcher) =>
            new ConformitySweepRunner(registry, dispatcher),
          inject: [AuthorityStatusPollerRegistry, DocumentQueueDispatcher],
        },
        {
          provide: DocumentActionProcessor,
          useFactory: (documentsService: DocumentsService, conformitySweepRunner: ConformitySweepRunner) =>
            new DocumentActionProcessor(documentsService, undefined, conformitySweepRunner),
          inject: [DocumentsService, ConformitySweepRunner],
        },
      ],
    }).compile();
    await moduleRef.init();

    sweepRunner = moduleRef.get(ConformitySweepRunner);
    // Force-instantiate the processor so its BullMQ `@Processor()` decorator actually registers a
    // worker for `Q_DOCUMENT_ACTION` — same requirement `document-schedule-queue.redis.spec.ts`
    // already documents implicitly by listing it as a provider.
    moduleRef.get(DocumentActionProcessor);
    queue = moduleRef.get<Queue>(getQueueToken(Q_DOCUMENT_ACTION));

    const company = await prisma.company.create({
      data: {
        name: 'Conformity Integration Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Conformity Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `conformity-integration-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    // Real credentials, encrypted at rest exactly like production (`CREDENTIALS_ENCRYPTION_KEY` —
    // `.env.test`'s own copy is a throwaway test key, see that file's own comment). Whichever process's
    // `PdpClient` resolves this row — this spec's own worker, or the real :4000 backend's — it gets the
    // SAME `baseUrl` and therefore hits the SAME stub above.
    await channelCredentials.upsertChannelConfig(companyId, PDP_PROVIDER_ID, {
      environment: 'TEST',
      isActive: true,
      config: { baseUrl: pdpStub.baseUrl, clientId: 'stub-client-id', clientSecret: 'stub-client-secret' },
    });
  });

  afterAll(async () => {
    // TARGETED cleanup, never `queue.obliterate()` — see queue-test-cleanup.ts's own header: this
    // queue is SHARED with a live `start:test` backend's own worker, which registers its conformity
    // sweep repeatable on it ONLY at boot; obliterating the whole queue silently erases that
    // registration too.
    //
    // Deliberately NOT a wider purge to also stop the real backend from ever polling these documents
    // again after `pdpStub` closes below: this file's own header already establishes that a late hit
    // against a closed stub is expected and harmless (the stub server's own `close()` only runs after
    // this cleanup, and any poll that DID land earlier already went through `DocumentAuthorityEvent`'s
    // `@@unique([documentId, providerId, statusCode])`, which absorbs a repeat without a duplicate row)
    // — there is nothing extra to guard here beyond removing this spec's own queue jobs.
    if (queue && companyId) await removeQueueJobsForCompany(queue, companyId);
    if (companyId) {
      // `CompanyChannelConfig.companyId` cascades on delete (schema.prisma) — no separate cleanup
      // needed for the row `upsertChannelConfig` created above.
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
    await moduleRef?.close();
    // Closed LAST — see `startPdpStub`'s own header on why a late retry from the real backend must
    // never crash this process, however long after this file's own assertions it arrives.
    await pdpStub?.close().catch(() => undefined);
  });

  it('the real sweep finds an eligible document and journals a REAL event through a REAL job', async () => {
    const document = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'sent',
        data: {},
        transportRef: 'deposit-1',
        channelProviderId: PDP_PROVIDER_ID,
      },
    });

    // NO assertion on this call's own candidates/polled counts, deliberately: the live test
    // backend (:4000, WORKER_INLINE) runs the SAME 5s conformity sweep against the SAME database,
    // and can legitimately have polled this document to its TERMINAL state (fr:202) before this
    // manual pass even runs — in which case candidates is rightfully 0 here. In the shared-consumer
    // topology the deterministic invariant is the JOURNAL below (the events exist, exactly once, and
    // the lifecycle status never moved), never "MY pass saw it" — eligibility itself is pinned
    // deterministically by conformity-sweep.spec.ts's own unit tests. This exact assertion flaked
    // ~2 runs in 11 during validation before being removed.
    await sweepRunner.runSweep(new Date());

    const events = await waitFor(async () => {
      const rows = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
      return rows.length > 0 ? rows : undefined;
    });

    const codes = events.map((e) => e.statusCode).sort();
    expect(codes).toEqual(['fr:200', 'fr:202']);
    // The document's OWN lifecycle status never moved because of this — the dedicated proof this
    // task's own brief requires, here against a REAL row, not a mock.
    const reread = await prisma.documentInstance.findUniqueOrThrow({ where: { id: document.id } });
    expect(reread.status).toBe('sent');
  });

  it('two sweep passes racing on the SAME eligible document journal NO duplicate rows', async () => {
    const document = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'sent',
        data: {},
        transportRef: 'deposit-2',
        channelProviderId: PDP_PROVIDER_ID,
      },
    });

    const now = new Date();
    // Genuinely concurrent — both calls read the same eligible row before either dispatches. The
    // poll jobId is a wall-clock WINDOW derived from this SAME `now`
    // (`conformity-sweep.ts#buildConformityPollJobId`), so both calls compute the IDENTICAL jobId —
    // BullMQ's own jobId idempotency (`Queue.add()` given an id that already exists resolves to the
    // existing job) is what makes this race safe, even before the `DocumentAuthorityEvent` table's
    // own `@@unique` ever gets a chance to matter.
    const [first, second] = await Promise.all([sweepRunner.runSweep(now), sweepRunner.runSweep(now)]);
    // Same shared-consumer reasoning as the first test above: the live backend's own sweep can win
    // the race and leave BOTH manual passes with 0 candidates — the invariant that matters is below
    // (the journal holds each code exactly once, however the three-way race landed).
    void first;
    void second;

    await waitFor(async () => {
      const rows = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
      return rows.length > 0 ? rows : undefined;
    });
    // Settle: give a genuinely SECOND (duplicate) job, if the jobId dedup had somehow failed, time to
    // also finish processing before the final count is taken.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const rows = await prisma.documentAuthorityEvent.findMany({ where: { documentId: document.id } });
    const codes = rows.map((r) => r.statusCode).sort();
    expect(codes).toEqual(['fr:200', 'fr:202']); // never four (200,200,202,202) however the race landed
  });
});
