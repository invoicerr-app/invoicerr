import * as nodemailer from 'nodemailer';

import { MailService } from '@/mail/mail.service';
import { resolveCompanyMailSettings } from '@/modules/company/mail-settings/company-mail-settings.resolver';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import * as takeNumber from '../numbering/take-number';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import * as stock from '../stock/apply-stock-on-issuance';
import * as companyEmailTemplates from './company-email-templates';
import { sendDocumentInstanceEmail } from './send-document-email';

jest.mock('../numbering/take-number');
jest.mock('../rendering/render-instance-pdf');
jest.mock('../stock/apply-stock-on-issuance');
jest.mock('./company-email-templates');
// Only used by the "société → instance" cascade tests near the bottom of this file — every other
// test here keeps using a bare fake `mailService` object, never touching this at all.
jest.mock('@/modules/company/mail-settings/company-mail-settings.resolver', () => ({
  resolveCompanyMailSettings: jest.fn(),
}));

const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as jest.Mock;

/**
 * `sendDocumentInstanceEmail` in isolation — the shared core behind the quote's own "send"
 * (generic-actions.ts) and the invoice's "email" transport (transports/email-transport.ts). Its own
 * dependencies (`renderDocumentInstance`, `getCompanyDocumentEmailTemplates`,
 * `takeDocumentNumberForTransition`) are mocked at their ENTRY POINT — never this function's own
 * internals — so a test here proves the real orchestration, not a re-implementation of it. See this
 * function's own header (send-document-email.ts) for the numbering/PDF-failure design this spec is
 * the direct coverage for.
 */
function buildDeps() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  const mailService = {
    sendForCompany: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }),
  };

  return { typeRegistry, referenceRegistry: new EntityReferenceRegistry(), mailService };
}

const FAKE_PDF = Buffer.from('%PDF-fake-content');

function mockSuccessfulRender(overrides: { language?: string } = {}) {
  (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
    pdf: FAKE_PDF,
    totals: {
      currency: 'EUR',
      lines: [],
      netMinor: 0,
      vatMinor: 0,
      grossMinor: 0,
      vatBreakdown: [],
      warnings: [],
    },
    referenceLabels: {},
    companyName: 'Acme Corp',
    // Per-recipient document language — `renderDocumentInstance` always resolves and returns this now (see
    // `rendering/render-instance-pdf.ts`'s own `RenderedDocumentInstance.language`); 'en' matches every
    // pre-existing test's expectations exactly (the English descriptor default), and is the same value
    // `resolveEmailTemplate`'s own default parameter would apply if this were omitted entirely.
    language: overrides.language ?? 'en',
  });
}

describe('sendDocumentInstanceEmail', () => {
  afterEach(() => jest.resetAllMocks());

  it('attaches the PDF the render engine produced, named after the FALLBACK when the document has no displayNumber', async () => {
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    const result = await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(mailService.sendForCompany).toHaveBeenCalledWith('company-1', {
      to: 'client@example.com',
      subject: expect.any(String),
      text: expect.any(String),
      attachments: [{ filename: 'quote-doc-1.pdf', content: FAKE_PDF, contentType: 'application/pdf' }],
    });
    expect(result.message).toMatch(/client@example\.com/);
    // Legal archiving ("archivage légal") — the artifact handed back for archiving is the EXACT
    // same bytes just attached, never a freshly re-rendered copy.
    expect(result.artifacts).toEqual([
      { role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array(FAKE_PDF) },
    ]);
  });

  it('names the attachment after displayNumber when the document is ALREADY numbered', async () => {
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: 1,
          displayNumber: 'QUOTE-2026-0001',
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    // Already numbered — no reason to ever ask the sequence for another one.
    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        attachments: [expect.objectContaining({ filename: 'QUOTE-2026-0001.pdf' })],
      }),
    );
  });

  // Since the async-send queue, quote.descriptor.ts's own `numbering.onEnterStatus` is "sending", not
  // "sent" — `runAsyncSendAction` (actions/async-send.ts) only ever calls THIS function once the
  // record is already "sending", so in the normal flow it is already numbered by then (see this
  // file's own header, "Numbering — a defensive fallback"). This test still proves the fallback
  // itself fires correctly for a document that reaches this function unnumbered at exactly its
  // declared `onEnterStatus` — a legitimate defensive case, not the routine one.
  it('pulls the number FORWARD (before composing the email) when the document is unnumbered at exactly its declared onEnterStatus', async () => {
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue({
      number: 7,
      displayNumber: 'QUOTE-2026-0007',
    });

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sending', // quote.descriptor.ts: numbering.onEnterStatus === 'sending'
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(takeNumber.takeDocumentNumberForTransition).toHaveBeenCalledWith('company-1', 'quote', 'doc-1');
    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        subject: expect.stringContaining('QUOTE-2026-0007'),
        attachments: [expect.objectContaining({ filename: 'QUOTE-2026-0007.pdf' })],
      }),
    );
  });

  // The explicit choice: a PDF render failure must FAIL THE SEND, never degrade to a
  // bare email — see send-document-email.ts's own header ("PDF failure — fails LOUDLY"). Mocks the
  // render ENTRY POINT (`renderDocumentInstance`) failing exactly the way real Puppeteer
  // unavailability would (rendering/render-pdf.ts's own error message), never this function's own
  // try/catch (there is none to mock around) — so this test cannot pass for the wrong reason.
  it("a PDF failure never sends a bare email — the whole send fails with the render engine's own error", async () => {
    const renderError = new Error('PDF renderer unavailable: Chrome/Chromium could not be launched.');
    (renderInstancePdf.renderDocumentInstance as jest.Mock).mockRejectedValue(renderError);
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    const action = sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    await expect(action).rejects.toBe(renderError);
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
  });

  // Stock effect — this is the PRIMARY issuance path for a sent document: it is numbered
  // HERE (the worker), not in documents.service.ts's runAction epilogue, so the stock decrement must
  // fire HERE, tied to actually TAKING the number.
  it('decrements stock when it TAKES the number at issuance (the real async-send path)', async () => {
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue({
      number: 7,
      displayNumber: 'QUOTE-2026-0007',
    });

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();
    const lines = [{ articleId: 'article-1', quantity: 8 }];

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sending', // quote.descriptor.ts: numbering.onEnterStatus === 'sending'
          data: { lines },
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(stock.applyStockOnIssuance).toHaveBeenCalledTimes(1);
    expect(stock.applyStockOnIssuance).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ id: 'doc-1', data: { lines } }),
    );
  });

  it('does NOT decrement stock when the document is ALREADY numbered (a re-send is a stock no-op)', async () => {
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: { lines: [{ articleId: 'article-1', quantity: 8 }] },
          createdAt: new Date(),
          updatedAt: new Date(),
          number: 1,
          displayNumber: 'QUOTE-2026-0001',
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    expect(stock.applyStockOnIssuance).not.toHaveBeenCalled();
  });

  it("the company's OWN template override wins over the descriptor default", async () => {
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({
      quote: { subject: 'OVERRIDDEN SUBJECT', body: 'OVERRIDDEN BODY' },
    });
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ subject: 'OVERRIDDEN SUBJECT', text: 'OVERRIDDEN BODY' }),
    );
    // A text-only template still sends a text-only email — no empty html part invented for it.
    expect(mailService.sendForCompany.mock.calls[0][1]).not.toHaveProperty('html');
  });

  it('sends BOTH parts when the template carries html, escaping interpolated values into the html one', async () => {
    (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
      pdf: FAKE_PDF,
      totals: {
        currency: 'EUR',
        lines: [],
        netMinor: 0,
        vatMinor: 0,
        grossMinor: 0,
        vatBreakdown: [],
        warnings: [],
      },
      referenceLabels: {},
      // A company name that is legitimate data and also happens to contain markup.
      companyName: 'Acme <Corp> & Co',
    });
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({
      quote: {
        subject: '{typeLabel} from {companyName}',
        body: 'Plain from {companyName}',
        html: '<p>Rich from {companyName}</p>',
      },
    });

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: 1,
          displayNumber: 'QUOTE-2026-0001',
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        subject: 'Quote from Acme <Corp> & Co',
        text: 'Plain from Acme <Corp> & Co',
        html: '<p>Rich from Acme &lt;Corp&gt; &amp; Co</p>',
        attachments: [expect.objectContaining({ contentType: 'application/pdf' })],
      }),
    );
  });

  it('derives a text part rather than sending html alone, for a template that carries only html', async () => {
    mockSuccessfulRender();
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({
      quote: { subject: 'Quote {displayNumber}', body: '', html: '<p>Hello,</p><p>See attached.</p>' },
    });

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: 1,
          displayNumber: 'QUOTE-2026-0001',
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    // Never an html-only message: that is what a text-only client, a screen reader and most spam
    // filters would see as empty.
    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        subject: 'Quote QUOTE-2026-0001',
        text: 'Hello,\nSee attached.',
        html: '<p>Hello,</p><p>See attached.</p>',
      }),
    );
  });

  // Per-recipient document language ("langue du document par destinataire") — the email must go out in the
  // SAME language `rendered.language` says the attached PDF was just rendered in, never a second,
  // independently-resolved value (see send-document-email.ts's own comment on this call).
  it("sends the descriptor's FRENCH default when the render resolved the recipient's language to 'fr'", async () => {
    mockSuccessfulRender({ language: 'fr' });
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        subject: expect.stringContaining('de Acme Corp'),
        text: expect.stringContaining('Veuillez trouver ci-joint'),
      }),
    );
    const sentEmail = mailService.sendForCompany.mock.calls[0][1];
    expect(sentEmail.subject).not.toContain('from Acme Corp');
    expect(sentEmail.text).not.toContain('Please find attached');
  });

  // A company's OWN wording is sent exactly as written, in whatever language the company itself wrote
  // it in — the resolved recipient language must never override, or even be consulted for, an
  // existing company override. See email-template.ts#resolveEmailTemplate's own header.
  it('a company override still wins even when the render resolved a non-English recipient language', async () => {
    mockSuccessfulRender({ language: 'it' });
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({
      quote: { subject: 'OVERRIDDEN SUBJECT', body: 'OVERRIDDEN BODY' },
    });
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const { typeRegistry, referenceRegistry, mailService } = buildDeps();

    await sendDocumentInstanceEmail(
      { mailService: mailService as never, typeRegistry, referenceRegistry },
      {
        companyId: 'company-1',
        typeId: 'quote',
        document: {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        },
        recipient: 'client@example.com',
        label: 'Quote',
      },
    );

    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ subject: 'OVERRIDDEN SUBJECT', text: 'OVERRIDDEN BODY' }),
    );
  });

  // The two tests below use a REAL `MailService` (only `resolveCompanyMailSettings` and
  // `nodemailer.createTransport` are mocked, the exact same doubles `mail.service.spec.ts` uses for
  // its own cascade coverage) rather than a fake `{ sendForCompany: jest.fn() }`: every OTHER test in
  // this file already proves the ADDRESSING/composition logic against a fake, so this is the one place
  // that proves `sendDocumentInstanceEmail` genuinely reaches the right transport end-to-end, not just
  // that it calls a method with the right name.
  describe('the société → instance → refus-nommé cascade, exercised through a REAL MailService', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
      jest.restoreAllMocks(); // undoes any jest.spyOn(nodemailer, 'createTransport') from a prior test
      mockedResolveCompanyMailSettings.mockReset();
      process.env = { ...ORIGINAL_ENV };
      delete process.env.MAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      delete process.env.SMTP_HOST;
    });

    afterAll(() => {
      process.env = ORIGINAL_ENV;
    });

    it("sends through THIS company's own SMTP server when Settings → Mail has one configured, never the instance's", async () => {
      mockSuccessfulRender();
      (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
      (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);
      process.env.SMTP_HOST = 'instance-smtp.example.com'; // instance IS configured too — must be ignored

      mockedResolveCompanyMailSettings.mockResolvedValue({
        kind: 'smtp',
        host: 'company-smtp.example.com',
        port: 587,
        secure: false,
        username: 'user',
        password: 'pass',
        fromAddress: 'billing@company.example.com',
      });
      const sendMailMock = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

      const { typeRegistry, referenceRegistry } = buildDeps();
      const mailService = new MailService();

      await sendDocumentInstanceEmail(
        { mailService, typeRegistry, referenceRegistry },
        {
          companyId: 'company-with-own-server',
          typeId: 'quote',
          document: {
            id: 'doc-1',
            typeId: 'quote',
            status: 'sent',
            data: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            number: null,
            displayNumber: null,
          },
          recipient: 'client@example.com',
          label: 'Quote',
        },
      );

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'company-smtp.example.com' }),
      );
    });

    it("falls back to the instance's own mail server when this company has none configured", async () => {
      mockSuccessfulRender();
      (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
      (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);
      process.env.SMTP_HOST = 'instance-smtp.example.com';
      mockedResolveCompanyMailSettings.mockResolvedValue(null);

      const sendMailMock = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

      const { typeRegistry, referenceRegistry } = buildDeps();
      const mailService = new MailService();

      await sendDocumentInstanceEmail(
        { mailService, typeRegistry, referenceRegistry },
        {
          companyId: 'company-without-own-server',
          typeId: 'quote',
          document: {
            id: 'doc-1',
            typeId: 'quote',
            status: 'sent',
            data: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            number: null,
            displayNumber: null,
          },
          recipient: 'client@example.com',
          label: 'Quote',
        },
      );

      // ONE call to createTransport (the instance provider, built at MailService construction) using
      // the instance's own host — no per-company override was ever consulted for a transport.
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'instance-smtp.example.com' }),
      );
    });

    it('refuses NAMED, and the send fails with that exact message, when neither company nor instance has anything configured', async () => {
      mockSuccessfulRender();
      (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
      (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);
      mockedResolveCompanyMailSettings.mockResolvedValue(null);

      const { typeRegistry, referenceRegistry } = buildDeps();
      const mailService = new MailService();

      const action = sendDocumentInstanceEmail(
        { mailService, typeRegistry, referenceRegistry },
        {
          companyId: 'company-with-nothing-configured',
          typeId: 'quote',
          document: {
            id: 'doc-1',
            typeId: 'quote',
            status: 'sent',
            data: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            number: null,
            displayNumber: null,
          },
          recipient: 'client@example.com',
          label: 'Quote',
        },
      );

      // This is exactly the message `queue/mark-send-failed.ts` records, verbatim, as the document's
      // own `send_failed` reason — see that mechanism's own coverage
      // (mark-send-failed.spec.ts) for the write itself; this test only proves the message that reaches
      // it is the NAMED refusal, never a generic one.
      await expect(action).rejects.toThrow(
        'No mail server is configured: this company has none set in Settings → Mail, and this instance ' +
          'has neither RESEND_API_KEY nor SMTP_HOST configured either. Configure one before sending.',
      );
    });
  });
});
