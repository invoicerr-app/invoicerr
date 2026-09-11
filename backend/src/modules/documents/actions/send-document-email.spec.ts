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
  const mailService = { sendMail: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }) };

  return { typeRegistry, referenceRegistry: new EntityReferenceRegistry(), mailService };
}

const FAKE_PDF = Buffer.from('%PDF-fake-content');

function mockSuccessfulRender() {
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

    expect(mailService.sendMail).toHaveBeenCalledWith({
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
    expect(mailService.sendMail).toHaveBeenCalledWith(
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
    expect(mailService.sendMail).toHaveBeenCalledWith(
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
    expect(mailService.sendMail).not.toHaveBeenCalled();
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

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'OVERRIDDEN SUBJECT', text: 'OVERRIDDEN BODY' }),
    );
  });
});
