/**
 * Real SMTP round-trip for the quote "send" action's mail content — opt-in, hits the local Mailpit
 * container the dev/test stack already runs (SMTP :1025, its own API on :8025), no external
 * credentials needed.
 *
 *   DOCUMENTS_MAIL_LIVE=1 SMTP_HOST=localhost SMTP_PORT=1025 npx jest send-quote.live --no-coverage
 *
 * Skipped by default: the offline `backend-tests` CI job provisions no SMTP server on :1025, so this
 * would otherwise hang or fail there. This is exactly the case a MOCKED test cannot prove — see
 * documents.service.spec.ts's "send" coverage for the wiring (the right recipient/subject reach
 * MailService.sendMail) and MEMORY "KSeF mock tests = false confidence" for why that mocked coverage
 * alone is never evidence the message actually gets delivered anywhere.
 *
 * Exercises the exact `buildQuoteEmailText` used by the real handler (quote-actions.ts) and the real
 * `MailService` — not a re-implementation of either — through the real SmtpMailProvider, then reads
 * the message back out of Mailpit's own HTTP API to prove it actually arrived.
 */
import { MailService } from '@/mail/mail.service';

import { buildQuoteEmailText } from './quote-actions';

const live = process.env.DOCUMENTS_MAIL_LIVE === '1';
const describeLive = live ? describe : describe.skip;

const MAILPIT_API = 'http://localhost:8025/api/v1';

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function findMailpitMessageBySubject(subject: string): Promise<MailpitMessageSummary | undefined> {
  const res = await fetch(`${MAILPIT_API}/messages?limit=50`);
  const body = (await res.json()) as { messages: MailpitMessageSummary[] };
  return body.messages.find((message) => message.Subject === subject);
}

async function fetchMailpitMessageText(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT_API}/message/${id}`);
  const body = (await res.json()) as { Text: string };
  return body.Text;
}

describeLive('quote "send" action — real SMTP delivery to Mailpit', () => {
  jest.setTimeout(15_000);

  it('lands a real message in Mailpit, with the recipient and the generated content', async () => {
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST ||= 'localhost';
    process.env.SMTP_PORT ||= '1025';
    process.env.SMTP_SECURE ||= 'false';
    process.env.SMTP_FROM ||= 'quotes@invoicerr.test';

    const mailService = new MailService();
    const recipient = 'live-test-client@example.com';
    const subject = `Live test quote — ${Date.now()}`;
    const text = buildQuoteEmailText({
      id: 'live-test-doc',
      data: {
        currency: 'EUR',
        notes: 'Thanks for your business.',
        lines: [{ description: 'Consulting', quantity: 2, unitPrice: 150 }],
      },
    });

    await expect(mailService.sendMail({ to: recipient, subject, text })).resolves.toMatchObject({
      message: 'Email sent successfully',
    });

    // Mailpit indexes locally-delivered mail almost instantly, but this polls briefly rather than
    // trusting a single read right after sendMail() resolves.
    let found: MailpitMessageSummary | undefined;
    for (let attempt = 0; attempt < 15 && !found; attempt++) {
      found = await findMailpitMessageBySubject(subject);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(found).toBeDefined();
    expect(found!.To[0]?.Address).toBe(recipient);

    const deliveredText = await fetchMailpitMessageText(found!.ID);
    expect(deliveredText).toContain('Consulting');
    expect(deliveredText).toContain('live-test-doc');
  });
});
