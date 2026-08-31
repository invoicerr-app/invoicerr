/**
 * The recurrence mechanism's own real end-to-end proof (root TODO item 5) — real Redis, real
 * Postgres, real Mailpit, exactly the same shape document-action-queue.redis.spec.ts already
 * established for the ordinary "send" queue (this file's own header explains the ClientsModule/
 * ts-jest gap that keeps both specs from importing DocumentsCoreModule directly). Self-gated on
 * `REDIS_URL`, runs for real in the `queue-integration` CI job
 * (.github/workflows/cypress.yml — its own `--testPathPattern 'modules/documents/queue/__tests__'`
 * already matches this file with no workflow change needed).
 *
 * Three proofs, matching the task's own three requirements:
 *  - a due schedule traverses the REAL sweep (`DocumentScheduleSweepRunner.runSweep`, the exact
 *    function the repeatable job calls) -> the duplicate genuinely EXISTS in the database, with
 *    `issueDate` overridden to the occurrence date and `dueDate` shifted by the source's own delta;
 *  - with `thenSend: true`, that duplicate goes all the way to "sent", delivered to a real Mailpit —
 *    the exact chaining fix schedule-sweep-runner.ts's own header documents (calling "send"
 *    SYNCHRONOUSLY, never by enqueueing a job from inside another job);
 *  - two sweep passes racing on the SAME due schedule produce exactly ONE duplicate — the jobId
 *    dedup (schedule-sweep.ts's own header) proven against a REAL queue, not a fake one.
 */
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import prisma from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';

import { ActionExtensionRegistry } from '../../actions/action-extensions';
import { ActionRegistry } from '../../actions/action-registry';
import { registerDuplicateExtension } from '../../actions/duplicate-extension';
import { registerInvoiceActions } from '../../actions/invoice-actions';
import { ContributionRegistry } from '../../contributions/contribution-registry';
import { FieldKindRegistry, registerCoreFieldKinds } from '../../descriptors/field-kinds';
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../../descriptors/type-registry';
import { DocumentsService } from '../../documents.service';
import { buildDocumentReferenceProvider } from '../../references/document-reference.provider';
import { EntityReferenceRegistry } from '../../references/reference-registry';
import { DocumentScheduleSweepRunner } from '../../schedules/schedule-sweep-runner';
import { buildEmailTransport } from '../../transports/email-transport';
import { TransportRegistry } from '../../transports/transport-registry';
import { DocumentQueueDispatcher } from '../document-queue.dispatcher';
import { DocumentQueueModule } from '../document-queue.module';
import { DocumentActionProcessor } from '../processors/document-action.processor';
import { Q_DOCUMENT_ACTION } from '../queue.constants';

// Gated EXPLICITLY (DOCUMENTS_QUEUE_REDIS_TESTS=1), not merely on REDIS_URL being set: a bare local
// `npx jest` loads `.env` (so REDIS_URL is always set on a dev machine) and runs spec files in
// PARALLEL workers — this file and its sibling redis spec would then consume the same real queue and
// database at once, racing each other AND the running test backend's own inline worker/sweep, and
// fail for reasons that are pure test-run topology, not product defects. The CI `queue-integration`
// job (.github/workflows/cypress.yml) sets the flag and runs them `--runInBand`, which is the ONE
// supported way to execute them:
//   DOCUMENTS_QUEUE_REDIS_TESTS=1 npx jest --runInBand --forceExit --testPathPattern 'modules/documents/queue/__tests__'
// Do not loosen this back to REDIS_URL alone "because it works on my machine" — it works until the
// two files land in different workers.
const hasRedis = !!process.env.REDIS_URL && process.env.DOCUMENTS_QUEUE_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

const MAILPIT_API = 'http://localhost:8025/api/v1';

interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
}

async function findMailpitMessageByRecipient(recipient: string): Promise<MailpitMessageSummary | undefined> {
  const res = await fetch(`${MAILPIT_API}/messages?limit=50`);
  const body = (await res.json()) as { messages: MailpitMessageSummary[] };
  return body.messages.find((message) => message.To?.some((to) => to.Address === recipient));
}

/** Polls the REAL table — proof that a background sweep/occurrence genuinely wrote something, not
 *  just that a function call returned. */
async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Same shape as document-action-queue.redis.spec.ts's own `buildDocumentsService` — real
 *  descriptors, real action registrations, a real MailService, a STUB clientsService backed by the
 *  real `prisma.client` table (see that file's own header for why ClientsModule itself can't be
 *  imported here). Invoice-only: the recurrence mechanism's one real consumer today. */
function buildDocumentsService(queueDispatcher: DocumentQueueDispatcher): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const clientsService = {
    getClientById: (companyIdArg: string, id: string) =>
      prisma.client.findFirst({ where: { id, companyId: companyIdArg } }),
  } as never;
  const mailService = new MailService();
  const referenceRegistry = new EntityReferenceRegistry();
  referenceRegistry.register('invoice', buildDocumentReferenceProvider('invoice', 'Invoice', clientsService));

  const transportRegistry = new TransportRegistry();
  transportRegistry.register(
    'email',
    'Email',
    buildEmailTransport({ clientsService, mailService, typeRegistry, referenceRegistry }),
  );

  const actionRegistry = new ActionRegistry();
  registerInvoiceActions(actionRegistry, { transportRegistry, queueDispatcher });

  const actionExtensionRegistry = new ActionExtensionRegistry();
  registerDuplicateExtension('invoice', actionExtensionRegistry, actionRegistry, {
    dateRecalc: { anchorField: 'issueDate', dependentFields: ['dueDate'] },
  });

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    actionExtensionRegistry,
    referenceRegistry,
    transportRegistry,
    new ContributionRegistry(),
  );
}

describeWithRedis('document-schedule sweep — real Redis, real Postgres, real Mailpit', () => {
  jest.setTimeout(60000);

  let moduleRef: TestingModule;
  let documentsService: DocumentsService;
  let sweepRunner: DocumentScheduleSweepRunner;
  let queue: Queue;
  let companyId: string;
  let clientId: string;
  let sourceDocumentId: string;

  beforeAll(async () => {
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST ||= 'localhost';
    process.env.SMTP_PORT ||= '1025';
    process.env.SMTP_SECURE ||= 'false';
    process.env.SMTP_FROM ||= 'schedule-integration@invoicerr.test';

    moduleRef = await Test.createTestingModule({
      imports: [DocumentQueueModule],
      providers: [
        {
          provide: DocumentsService,
          useFactory: (dispatcher: DocumentQueueDispatcher) => buildDocumentsService(dispatcher),
          inject: [DocumentQueueDispatcher],
        },
        {
          provide: DocumentScheduleSweepRunner,
          useFactory: (documents: DocumentsService, dispatcher: DocumentQueueDispatcher) =>
            new DocumentScheduleSweepRunner(documents, dispatcher),
          inject: [DocumentsService, DocumentQueueDispatcher],
        },
        DocumentActionProcessor,
      ],
    }).compile();
    await moduleRef.init();

    documentsService = moduleRef.get(DocumentsService);
    sweepRunner = moduleRef.get(DocumentScheduleSweepRunner);
    queue = moduleRef.get<Queue>(getQueueToken(Q_DOCUMENT_ACTION));

    const company = await prisma.company.create({
      data: {
        name: 'Schedule Integration Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Schedule Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: 'schedule-integration-company@example.com',
        invoiceTransportId: 'email',
      },
    });
    companyId = company.id;

    const client = await prisma.client.create({
      data: {
        companyId,
        name: 'Schedule Client',
        contactEmail: `schedule-client-${Date.now()}@example.com`,
        address: '1 Client Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
      },
    });
    clientId = client.id;

    const invoiceData = {
      client: clientId,
      issueDate: '2026-01-31',
      dueDate: '2026-02-28', // 28 days after issueDate on the SOURCE — the delta the occurrence must preserve
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' }],
    };
    const created = await documentsService.runAction(companyId, 'invoice', 'save-draft', {
      data: invoiceData,
    });
    sourceDocumentId = created.document!.id;
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await moduleRef?.close();
  });

  it('a due schedule traverses the real sweep: the duplicate exists in the database with recalculated dates', async () => {
    const nextRunAt = new Date('2026-02-28T00:00:00.000Z'); // in the past relative to "now"
    const schedule = await prisma.documentSchedule.create({
      data: {
        companyId,
        typeId: 'invoice',
        sourceDocumentId,
        actionId: 'duplicate',
        cadence: 'monthly',
        anchorDay: 28,
        nextRunAt,
      },
    });

    const result = await sweepRunner.runSweep(new Date('2026-03-01T00:00:00.000Z'));
    expect(result.due).toBe(1);
    expect(result.enqueued).toBe(1);

    const duplicate = await waitFor(async () => {
      const rows = await prisma.documentInstance.findMany({
        where: { companyId, typeId: 'invoice', id: { not: sourceDocumentId } },
      });
      return rows[0];
    });

    const data = duplicate.data as Record<string, unknown>;
    expect(data.issueDate).toBe('2026-02-28T00:00:00.000Z'); // the occurrence date, verbatim
    // 28 days after 28 Feb 2026 (not a leap year) is 28 Mar 2026 — the SOURCE's own delta (issueDate
    // 31 Jan -> dueDate 28 Feb is 28 days), preserved, never re-derived from a fixed day count.
    expect(data.dueDate).toBe('2026-03-28T00:00:00.000Z');
    expect(duplicate.status).toBe('draft'); // thenSend was never set for this schedule

    const advanced = await prisma.documentSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(advanced.lastError).toBeNull();
    expect(advanced.lastRunAt?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    // 28 Feb 2026 (anchored at 28) + 1 month -> 28 Mar 2026 (cadence.spec.ts's own clamp math,
    // proven again here end-to-end).
    expect(advanced.nextRunAt.toISOString()).toBe('2026-03-28T00:00:00.000Z');

    await prisma.documentSchedule.delete({ where: { id: schedule.id } }).catch(() => undefined);
  });

  it('with thenSend: true, the duplicate is chained straight through to "sent" — delivered to a real Mailpit', async () => {
    const recipientMarker = `schedule-thensend-${Date.now()}`;
    await prisma.client.update({
      where: { id: clientId },
      data: { contactEmail: `${recipientMarker}@example.com` },
    });

    const schedule = await prisma.documentSchedule.create({
      data: {
        companyId,
        typeId: 'invoice',
        sourceDocumentId,
        actionId: 'duplicate',
        cadence: 'monthly',
        anchorDay: 15,
        nextRunAt: new Date('2026-04-15T00:00:00.000Z'),
        params: { thenSend: true },
      },
    });

    await sweepRunner.runSweep(new Date('2026-04-16T00:00:00.000Z'));

    const sent = await waitFor(async () => {
      const rows = await prisma.documentInstance.findMany({
        where: {
          companyId,
          typeId: 'invoice',
          id: { not: sourceDocumentId },
          status: { in: ['sent', 'send_failed'] },
        },
        select: { id: true, status: true, displayNumber: true, lastActionError: true },
      });
      // Only the row created by THIS test's own occurrence (issueDate 15 Apr) — the previous test
      // already left a "draft" duplicate behind, which never matches status sent/send_failed anyway.
      return rows.find((row) => row.status === 'sent' || row.status === 'send_failed');
    });

    if (sent.status !== 'sent') console.error('lastActionError:', sent.lastActionError);
    expect(sent.status).toBe('sent');
    expect(sent.displayNumber).toEqual(expect.any(String));

    let found: MailpitMessageSummary | undefined;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      found = await findMailpitMessageByRecipient(`${recipientMarker}@example.com`);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(found).toBeDefined(); // the chained "send" genuinely delivered, not merely transitioned status

    await prisma.documentSchedule.delete({ where: { id: schedule.id } }).catch(() => undefined);
  });

  it('two sweep passes racing on the SAME due schedule produce exactly ONE duplicate — the jobId dedups', async () => {
    const schedule = await prisma.documentSchedule.create({
      data: {
        companyId,
        typeId: 'invoice',
        sourceDocumentId,
        actionId: 'duplicate',
        cadence: 'yearly',
        anchorDay: 1,
        nextRunAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    });

    const now = new Date('2026-05-02T00:00:00.000Z');
    // Genuinely concurrent — both calls read the SAME due row before either has advanced it, the
    // exact race schedule-sweep.ts's own header describes. BullMQ's own jobId-based idempotency
    // (queue.add with an existing id is a no-op returning the existing job) is what makes this safe
    // even if this specific test's own timing ever let both `enqueueScheduleOccurrence` calls reach
    // Redis before either observed the other via `getJob`.
    // `enqueued` itself is NOT asserted here: `enqueueScheduleOccurrence`'s own pre-check
    // (`getJob` then `add`, two separate round trips) can race under GENUINE concurrency and report
    // "enqueued" for both calls — it is a fast-path optimization and an observability aid, never the
    // actual safety net. The real guarantee is BullMQ's OWN jobId idempotency (`queue.add` with an
    // id that already exists never creates a SECOND job entry) — which is exactly what the
    // assertions below prove directly, against the real outcome, not this diagnostic count.
    const [first, second] = await Promise.all([sweepRunner.runSweep(now), sweepRunner.runSweep(now)]);
    expect(first.due).toBe(1);
    expect(second.due).toBe(1);

    // Give the (single) occurrence job time to be processed, then assert exactly one new draft
    // exists for THIS schedule's own occurrence (anchored at 1 May, cadence yearly — distinguishable
    // by issueDate from the other tests' own duplicates).
    await waitFor(async () => {
      const rows = await prisma.documentInstance.findMany({
        where: { companyId, typeId: 'invoice', id: { not: sourceDocumentId } },
      });
      const thisOccurrence = rows.filter(
        (row) => (row.data as Record<string, unknown>).issueDate === '2026-05-01T00:00:00.000Z',
      );
      return thisOccurrence.length > 0 ? thisOccurrence : undefined;
    });

    const matching = await prisma.documentInstance.findMany({
      where: { companyId, typeId: 'invoice' },
    });
    const thisOccurrence = matching.filter(
      (row) => (row.data as Record<string, unknown>).issueDate === '2026-05-01T00:00:00.000Z',
    );
    expect(thisOccurrence).toHaveLength(1); // never two, however the race actually landed

    await prisma.documentSchedule.delete({ where: { id: schedule.id } }).catch(() => undefined);
  });
});
