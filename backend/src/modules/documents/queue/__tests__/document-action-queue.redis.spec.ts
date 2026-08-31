/**
 * The document-action queue's real end-to-end proof (TODO.md item 22) — real Redis, real Postgres,
 * real Mailpit, a real BullMQ worker consuming what the API side enqueued. Self-gated on `REDIS_URL`
 * (same pattern the pre-refonte compliance queue's own `queue-smoke.redis.spec.ts` used —
 * `avant-refonte-documents`): skipped entirely in the offline `backend-tests` CI job, which never
 * provisions Redis; runs for real in the `queue-integration` job (.github/workflows/cypress.yml).
 *
 * Deliberately does NOT import `DocumentsCoreModule` (which pulls in the real `ClientsModule`) — a
 * pre-existing, unrelated ts-jest/JSR resolution gap (`@teever/ez-hook`, reached transitively via
 * `ClientsModule` -> `WebhooksModule` -> `drivers/discord.driver.ts`) makes booting that MODULE
 * (as opposed to merely referencing `ClientsService` in a type position, which every other spec in
 * this directory already does safely) fail to even compile under jest today. Fixing that dependency
 * is out of this task's scope, so this file builds the SAME registries `documents-core.module.ts`
 * wires — real descriptors, real action registrations, a real `MailService` — with a plain STUB
 * `clientsService`, exactly the pattern documents.service.spec.ts/documents.service.invoice.spec.ts
 * already use throughout, PLUS the one piece those files never needed for real: a genuine BullMQ
 * `Queue`/`Worker` pair, wired through the REAL `DocumentQueueModule` and `DocumentActionProcessor` —
 * the actual thing this spec exists to prove.
 *
 * Two proofs:
 *  - a quote's "send" genuinely traverses the queue: draft -> sending (enqueued) -> a real worker
 *    delivers a real email to Mailpit -> sent, with the PDF attached and the number on the document.
 *  - an invoice's "send" that FAILS delivery (a deliberately dangling client reference — see this
 *    file's own header on why this, not a broken SMTP config, is the deterministic failure this test
 *    forces: SmtpMailProvider builds its nodemailer transporter ONCE at construction, so toggling
 *    SMTP_HOST between two calls in the same process would not work) lands on "send_failed" with the
 *    error recorded, and a re-`send` — after the underlying cause is fixed — succeeds.
 */
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import prisma from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';

import { ActionExtensionRegistry } from '../../actions/action-extensions';
import { ActionRegistry } from '../../actions/action-registry';
import { registerConvertToInvoiceAction } from '../../actions/convert-to-invoice';
import { registerCreditNoteActions } from '../../actions/credit-note-actions';
import { registerInvoiceActions } from '../../actions/invoice-actions';
import { registerQuoteActions } from '../../actions/quote-actions';
import { registerRequestDepositAction } from '../../actions/request-deposit';
import { ContributionRegistry } from '../../contributions/contribution-registry';
import { buildCreditNoteDescriptor } from '../../descriptors/credit-note.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from '../../descriptors/field-kinds';
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../../descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../../descriptors/type-registry';
import { DocumentsService } from '../../documents.service';
import { buildDocumentReferenceProvider } from '../../references/document-reference.provider';
import { EntityReferenceRegistry } from '../../references/reference-registry';
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
  Subject: string;
  To: { Address: string }[];
}

// Matched by RECIPIENT, never by subject: the quote's own displayNumber (and therefore its
// subject, "Quote QUOTE-2026-0001 from Queue Integration Co") restarts at 1 for every FRESH
// company this test creates, so two runs of this same suite (or a leftover message from a
// previous one Mailpit hasn't been cleared of) can share the exact same subject — this test's own
// `recipient` embeds `Date.now()` and is therefore the one thing guaranteed unique per run.
async function findMailpitMessageByRecipient(recipient: string): Promise<MailpitMessageSummary | undefined> {
  const res = await fetch(`${MAILPIT_API}/messages?limit=50`);
  const body = (await res.json()) as { messages: MailpitMessageSummary[] };
  return body.messages.find((message) => message.To?.some((to) => to.Address === recipient));
}

async function fetchMailpitMessage(id: string) {
  const res = await fetch(`${MAILPIT_API}/message/${id}`);
  return (await res.json()) as { Attachments: { FileName: string; ContentType: string }[] };
}

interface PolledDocument {
  status: string;
  displayNumber: string | null;
  lastActionError: string | null;
}

/** Polls the REAL row — this is what proves the queue actually ran, not what the API call returned
 *  synchronously (phase 1 always returns "sending" immediately; only the worker's own later write
 *  ever reaches one of `targetStatuses`). */
async function waitForStatus(
  documentId: string,
  targetStatuses: string[],
  timeoutMs = 20000,
): Promise<PolledDocument> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const doc = await prisma.documentInstance.findUniqueOrThrow({
      where: { id: documentId },
      select: { status: true, displayNumber: true, lastActionError: true },
    });
    if (targetStatuses.includes(doc.status)) return doc;
    if (Date.now() > deadline) {
      throw new Error(
        `document ${documentId} never reached ${targetStatuses.join('|')} (stuck at "${doc.status}") ` +
          `within ${timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * The producer-side wiring — one `DocumentsService`, built from the exact SAME real descriptors and
 * action registrations `documents-core.module.ts` uses, minus `ClientsModule`/`ArticlesModule` (see
 * this file's own header for why). `getClientById` is the REAL `ClientsService.getClientById`'s own
 * one-line body (`prisma.client.findFirst({ where: { id, companyId } })`, clients.service.ts),
 * reimplemented here directly against the real `prisma` singleton rather than importing the class
 * itself — a genuine, DB-backed lookup, not a permanently-empty stub: a dangling client id resolves
 * to null (forcing the invoice's delivery failure below), and a REAL client row created mid-test
 * resolves for real (proving the re-send actually recovers, not merely re-transitions).
 */
function buildDocumentsService(queueDispatcher: DocumentQueueDispatcher): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  typeRegistry.register(buildInvoiceDescriptor());
  typeRegistry.register(buildCreditNoteDescriptor());

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
  registerQuoteActions(actionRegistry, {
    clientsService,
    mailService,
    typeRegistry,
    referenceRegistry,
    queueDispatcher,
  });
  registerConvertToInvoiceAction(actionRegistry);
  registerRequestDepositAction(actionRegistry);
  registerInvoiceActions(actionRegistry, { transportRegistry, queueDispatcher });
  registerCreditNoteActions(actionRegistry, { queueDispatcher });

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    referenceRegistry,
    transportRegistry,
    new ContributionRegistry(),
  );
}

describeWithRedis('document-action queue — real Redis, real Postgres, real Mailpit', () => {
  jest.setTimeout(60000);

  let moduleRef: TestingModule;
  let documentsService: DocumentsService;
  let queue: Queue;
  let companyId: string;

  beforeAll(async () => {
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST ||= 'localhost';
    process.env.SMTP_PORT ||= '1025';
    process.env.SMTP_SECURE ||= 'false';
    process.env.SMTP_FROM ||= 'queue-integration@invoicerr.test';
    // A single attempt: the point of the "failure" half below is proving the TERMINAL path
    // (send_failed, error recorded) fires — not exercising BullMQ's own backoff timing, which is
    // already covered offline (document-action.processor.spec.ts's onFailed tests).
    process.env.DOCUMENT_ACTION_QUEUE_ATTEMPTS = '1';

    moduleRef = await Test.createTestingModule({
      imports: [DocumentQueueModule],
      providers: [
        {
          provide: DocumentsService,
          useFactory: (dispatcher: DocumentQueueDispatcher) => buildDocumentsService(dispatcher),
          inject: [DocumentQueueDispatcher],
        },
        DocumentActionProcessor,
      ],
    }).compile();
    await moduleRef.init();

    documentsService = moduleRef.get(DocumentsService);
    queue = moduleRef.get<Queue>(getQueueToken(Q_DOCUMENT_ACTION));

    const company = await prisma.company.create({
      data: {
        name: 'Queue Integration Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Queue Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: 'queue-integration-company@example.com',
        invoiceTransportId: 'email',
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await moduleRef?.close();
  });

  it('a quote\'s "send" traverses the real queue: draft -> sending -> a real worker delivers to Mailpit -> sent', async () => {
    const quoteData = {
      client: 'nonexistent-client-id', // the quote's own "send" never resolves the client — see quote-actions.ts
      issueDate: '2026-01-01',
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 2, unitPrice: 150 }],
    };

    const created = await documentsService.runAction(companyId, 'quote', 'save-draft', { data: quoteData });
    const documentId = created.document!.id;

    const recipient = `quote-integration-${Date.now()}@example.com`;
    const phase1 = await documentsService.runAction(companyId, 'quote', 'send', {
      documentId,
      data: quoteData,
      params: { recipient },
    });

    // Phase 1 is synchronous and returns BEFORE the worker ever runs — this is the API's own
    // immediate response, proven here so a regression collapsing the two phases back into one
    // (delivering synchronously again) would be caught the moment this assertion runs.
    expect(phase1.document?.status).toBe('sending');

    const settled = await waitForStatus(documentId, ['sent', 'send_failed']);
    // If this fails, settled.lastActionError carries the reason (log it via console.error below).
    if (settled.status !== 'sent') console.error('lastActionError:', settled.lastActionError);
    expect(settled.status).toBe('sent');
    expect(settled.displayNumber).toEqual(expect.any(String)); // a sent quote is numbered

    let found: MailpitMessageSummary | undefined;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      found = await findMailpitMessageByRecipient(recipient);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(found).toBeDefined(); // the email genuinely landed in Mailpit
    expect(found!.Subject).toBe(`Quote ${settled.displayNumber} from Queue Integration Co`);

    const message = await fetchMailpitMessage(found!.ID);
    expect(message.Attachments).toHaveLength(1);
    expect(message.Attachments[0].FileName).toBe(`${settled.displayNumber}.pdf`);
    expect(message.Attachments[0].ContentType).toBe('application/pdf');
  });

  it('an invoice "send" that fails delivery lands on "send_failed" with the error recorded, and a re-send after the fix succeeds', async () => {
    const invoiceData = {
      client: 'dangling-client-id', // resolves to null -> buildEmailTransport refuses -> delivery fails
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      currency: 'EUR',
      lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 500, vatRate: '20' }],
    };

    const created = await documentsService.runAction(companyId, 'invoice', 'save-draft', {
      data: invoiceData,
    });
    const documentId = created.document!.id;

    await documentsService.runAction(companyId, 'invoice', 'send', { documentId, data: invoiceData });

    const failed = await waitForStatus(documentId, ['sent', 'send_failed']);
    expect(failed.status).toBe('send_failed');
    expect(failed.lastActionError).toMatch(/no contact email on file/i); // recorded, never a silent gap
    const numberAfterFailure = failed.displayNumber;
    // a send_failed invoice keeps the number it was given entering "sending"
    expect(numberAfterFailure).toEqual(expect.any(String));

    // Fix the underlying cause: a REAL client, with a real contact email, replaces the dangling id —
    // `buildDocumentsService`'s own `getClientById` is a genuine DB-backed lookup, so this client
    // genuinely resolves this time. A genuine re-`send` — the retry IS the action itself
    // (actions/async-send.ts), never a separate mechanism — with the CORRECTED data.
    const client = await prisma.client.create({
      data: {
        companyId,
        name: 'Recovered Client',
        contactEmail: `recovered-${Date.now()}@example.com`,
        address: '1 Client Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
      },
    });
    const fixedData = { ...invoiceData, client: client.id };

    const retry = await documentsService.runAction(companyId, 'invoice', 'send', {
      documentId,
      data: fixedData,
    });
    expect(retry.document?.status).toBe('sending');

    const settled = await waitForStatus(documentId, ['sent', 'send_failed']);
    if (settled.status !== 'sent') console.error('lastActionError:', settled.lastActionError);
    expect(settled.status).toBe('sent');
    // No hole, no duplicate: the number a "send_failed" document already carried is exactly the one
    // it keeps once the retry succeeds — see numbering/take-number.ts's own "number IS NULL" guard.
    expect(settled.displayNumber).toBe(numberAfterFailure);

    await prisma.client.delete({ where: { id: client.id } }).catch(() => undefined);
  });
});
