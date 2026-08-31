/**
 * Real SMTP round-trip for the document-SEND path's PDF ATTACHMENT — opt-in, hits the local Mailpit
 * container the dev/test stack already runs (SMTP :1025, its own API on :8025), no external
 * credentials needed.
 *
 *   DOCUMENTS_MAIL_LIVE=1 SMTP_HOST=localhost SMTP_PORT=1025 \
 *     DATABASE_URL="postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db" \
 *     npx jest send-quote.live --no-coverage
 *
 * Skipped by default: the offline `backend-tests` CI job provisions no SMTP server on :1025, so this
 * would otherwise hang or fail there. This is exactly the case a MOCKED test cannot prove — see
 * send-document-email.spec.ts's own coverage for the wiring (the right recipient/subject/attachment
 * reach MailService.sendMail) and MEMORY "KSeF mock tests = false confidence" for why that mocked
 * coverage alone is never evidence a real PDF actually lands in a real inbox.
 *
 * Exercises the REAL `sendDocumentInstanceEmail` (send-document-email.ts) — the exact function both
 * the quote's own "send" (generic-actions.ts) and the invoice's "email" transport
 * (transports/email-transport.ts) call — through the real `renderDocumentInstance` (real Puppeteer,
 * real HTML->PDF pipeline) and the real `MailService`/`SmtpMailProvider`, then reads the message back
 * out of Mailpit's own HTTP API to prove an ACTUAL PDF attachment landed with the right name and
 * content-type, and that the subject was genuinely interpolated from quote.descriptor.ts's own
 * `email` template — not a re-implementation of any of it.
 *
 * Needs exactly ONE real row: a Company (for `renderDocumentInstance`'s own `prisma.company.findUnique`
 * — see that file's header). The document itself is a plain in-memory object, never persisted:
 * neither `sendDocumentInstanceEmail` nor anything it calls re-reads the instance from the database —
 * they operate on the `document` they are handed. Pre-numbered (`number`/`displayNumber` already set)
 * so this never touches `DocumentNumberSequence` either — the numbering-pulled-forward behavior has
 * its own, offline coverage in send-document-email.spec.ts.
 */
import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { sendDocumentInstanceEmail } from './send-document-email';

const live = process.env.DOCUMENTS_MAIL_LIVE === '1';
const describeLive = live ? describe : describe.skip;

const MAILPIT_API = 'http://localhost:8025/api/v1';

interface MailpitAttachmentSummary {
  FileName: string;
  ContentType: string;
}

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

interface MailpitMessageDetail {
  Subject: string;
  Attachments: MailpitAttachmentSummary[];
}

async function findMailpitMessageBySubject(subject: string): Promise<MailpitMessageSummary | undefined> {
  const res = await fetch(`${MAILPIT_API}/messages?limit=50`);
  const body = (await res.json()) as { messages: MailpitMessageSummary[] };
  return body.messages.find((message) => message.Subject === subject);
}

async function fetchMailpitMessage(id: string): Promise<MailpitMessageDetail> {
  const res = await fetch(`${MAILPIT_API}/message/${id}`);
  return (await res.json()) as MailpitMessageDetail;
}

describeLive('document "send" — real SMTP delivery to Mailpit, with the PDF actually attached', () => {
  jest.setTimeout(30_000);

  let companyId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Live Test Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        phone: '+33000000000',
        email: 'live-test-company@example.com',
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
  });

  it('lands a real message in Mailpit, with a PDF attachment named after the displayNumber, and an interpolated subject', async () => {
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST ||= 'localhost';
    process.env.SMTP_PORT ||= '1025';
    process.env.SMTP_SECURE ||= 'false';
    process.env.SMTP_FROM ||= 'quotes@invoicerr.test';

    const mailService = new MailService();
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(buildQuoteDescriptor());
    const referenceRegistry = new EntityReferenceRegistry();

    const recipient = 'live-test-client@example.com';
    const displayNumber = `QUOTE-LIVE-${Date.now()}`;
    const expectedSubject = `Quote ${displayNumber} from Live Test Co`;

    const result = await sendDocumentInstanceEmail(
      { mailService, typeRegistry, referenceRegistry },
      {
        companyId,
        typeId: 'quote',
        document: {
          id: 'live-test-doc',
          typeId: 'quote',
          status: 'sent',
          data: {
            client: 'live-client-id',
            issueDate: '2026-01-01',
            currency: 'EUR',
            notes: 'Thanks for your business.',
            lines: [{ description: 'Consulting', quantity: 2, unitPrice: 150, vatRate: '20' }],
          },
          createdAt: new Date(),
          updatedAt: new Date(),
          number: 1,
          displayNumber,
        },
        recipient,
        label: 'Quote',
      },
    );

    expect(result.message).toContain(recipient);

    // Mailpit indexes locally-delivered mail almost instantly, but this polls briefly rather than
    // trusting a single read right after sendDocumentInstanceEmail() resolves.
    let found: MailpitMessageSummary | undefined;
    for (let attempt = 0; attempt < 15 && !found; attempt++) {
      found = await findMailpitMessageBySubject(expectedSubject);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(found).toBeDefined();
    expect(found!.To[0]?.Address).toBe(recipient);

    const message = await fetchMailpitMessage(found!.ID);
    expect(message.Attachments).toHaveLength(1);
    expect(message.Attachments[0].FileName).toBe(`${displayNumber}.pdf`);
    expect(message.Attachments[0].ContentType).toBe('application/pdf');
  });
});
